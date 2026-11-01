// Package postmetrics reads the numbers of published posts (the old
// services/post-metrics-collection.ts, db/post-metrics.ts): Facebook Page
// posts' reactions, comments and shares (which "Post for me" learns from),
// and X's and YouTube's numbers through their connectors
// (core/internal/platforms). LinkedIn is never asked (its post numbers need
// a permission ansa's app can't have). Each read is a snapshot
// (post_metrics) that is never changed; a number the platform doesn't give
// is NULL, never 0.
package postmetrics

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/platforms"
	"ansa/core/internal/publishing"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// A post is read about once a day (its last try 20+ hours ago), from an
// hour after it went out (a snapshot of a post a minute old says nothing)
// until 30 days after.
const (
	intervalHours    = 20
	firstReadMinutes = 60
	// The most posts one round reads.
	roundSize = 20
)

// Collector reads due posts' numbers. LOGGING RULE: codes only, never a
// token or anything a platform wrote.
type Collector struct {
	Pool *database.Pool
	Box  *secure.Box
	Log  *logging.Logger
	// ansa's Meta app secret ("": nothing is asked).
	FacebookAppSecret string
	// The real read (a test replaces it: never a platform from a test).
	ReadFacebook func(ctx context.Context, appSecret, postID, pageToken string) (Numbers, string)
	// X and YouTube: the account made ready (renewed first), then its
	// connector asked. nil: those posts are not read.
	Renewer   *social.Renewer
	Platforms *platforms.Connectors
}

type claim struct {
	company                               tenant.CompanyID
	jobID, connectionID, postID, platform string
	publishedAt                           time.Time
}

// RunDue reads the numbers of due posts, the longest waiting first, at most
// 20 a round (the scheduler calls it). onlyCompany: the tests keep to theirs.
func (c *Collector) RunDue(ctx context.Context, onlyCompany string) (int, error) {
	read := 0
	for read < roundSize {
		next, err := claimNext(ctx, c.Pool, onlyCompany)
		if err != nil || next == nil {
			return read, err
		}
		if err := c.collect(ctx, next); err != nil {
			// Its claim stays: the post is due again in a day.
			return read, err
		}
		read++
	}
	return read, nil
}

// collect reads one claimed post: its Page read for one call (a Page that
// needs a reconnect or was disconnected is skipped with why, nothing
// asked), Facebook asked, the answer saved.
func (c *Collector) collect(ctx context.Context, next *claim) error {
	if next.platform != "facebook" {
		return c.collectOther(ctx, next)
	}
	page, err := social.PageForPosting(ctx, c.Pool, c.Box, next.company, next.connectionID)
	code := ""
	switch {
	case errors.Is(err, social.ErrNeedsReconnect):
		code = "reauthorization_needed"
	case errors.Is(err, social.ErrNotConnected):
		code = "account_disconnected"
	case errors.Is(err, social.ErrNotUsable):
		code = "account_unreadable"
	case err != nil:
		return err
	case c.FacebookAppSecret == "":
		code = "not_set_up"
	}
	if code != "" {
		c.Log.Warn("post metrics: skipped", logging.Code(code))
		return recordFailure(ctx, c.Pool, next, code, "")
	}
	numbers, failure := c.ReadFacebook(ctx, c.FacebookAppSecret, next.postID, page.Token)
	if failure == "" {
		return saveSnapshot(ctx, c.Pool, next, numbers)
	}
	c.Log.Warn("post metrics: not collected", logging.Code(failure))
	storedToken := ""
	if failure == "token_rejected" {
		storedToken = page.StoredToken
	}
	return recordFailure(ctx, c.Pool, next, failure, storedToken)
}

// claimNext claims the post of any company that waited longest for its
// numbers in ONE UPDATE (a scalar SKIP LOCKED subquery, as the publishing
// queue claims): a published Facebook, X or YouTube post with the
// platform's id (one marked published by hand has none), out 1 hour to its
// platform's read days ago (X's 28, the others' 30), not read in the last
// 20 hours, never a development stand-in's. metrics_attempted_at = now is
// the claim; updated_at is untouched (the queue sorts by it).
func claimNext(ctx context.Context, pool *database.Pool, onlyCompany string) (*claim, error) {
	const statement = `
		-- cross-company: the numbers' collector serves every company; the claimed row's own company is used after.
		UPDATE publish_jobs SET metrics_attempted_at = now()
		WHERE id = (
			SELECT jobs.id FROM publish_jobs AS jobs
			JOIN social_connections AS accounts ON accounts.company_id = jobs.company_id AND accounts.id = jobs.connection_id
			WHERE jobs.status = 'published' AND jobs.external_post_id IS NOT NULL
				AND jobs.published_at >= now() - make_interval(days => CASE accounts.platform WHEN 'x' THEN $5::int ELSE $1::int END)
				AND jobs.published_at <= now() - make_interval(mins => $2)
				AND (jobs.metrics_attempted_at IS NULL OR jobs.metrics_attempted_at < now() - make_interval(hours => $3))
				AND accounts.platform IN ('facebook', 'x', 'youtube') AND NOT accounts.is_stand_in
				AND ($4 = '' OR jobs.company_id::text = $4)
			ORDER BY jobs.metrics_attempted_at ASC NULLS FIRST, jobs.published_at, jobs.id
			FOR UPDATE OF jobs SKIP LOCKED
			LIMIT 1
		) AND status = 'published'
		RETURNING company_id, id, connection_id, external_post_id, published_at,
			(SELECT platform FROM social_connections WHERE social_connections.company_id = publish_jobs.company_id AND social_connections.id = publish_jobs.connection_id)`
	var companyText string
	var next claim
	err := pool.QueryRow(ctx, statement, platforms.NumbersReadDays, firstReadMinutes, intervalHours, onlyCompany, platforms.XNumbersReadDays).Scan(&companyText, &next.jobID, &next.connectionID,
		&next.postID, &next.publishedAt, &next.platform)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	next.company, err = tenant.FromTrustedSource(companyText)
	return &next, err
}

// saveSnapshot saves the numbers and clears the last failure, in one transaction.
func saveSnapshot(ctx context.Context, pool *database.Pool, next *claim, numbers Numbers) error {
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		const clear = `UPDATE publish_jobs SET metrics_error = NULL WHERE company_id = $1 AND id = $2 AND status = 'published'`
		tag, err := tx.Exec(ctx, clear, next.company.String(), next.jobID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		// Every column named; Facebook gives no views, reach, clicks or video views here.
		const insert = `
			INSERT INTO post_metrics (company_id, publish_job_id, collected_at, views, reach, reactions, comments, shares, clicks, video_views, source)
			VALUES ($1, $2, now(), NULL, NULL, $3, $4, $5, NULL, NULL, 'platform')`
		_, err = tx.Exec(ctx, insert, next.company.String(), next.jobID, numbers.Reactions, numbers.Comments, numbers.Shares)
		return err
	})
}

// recordFailure keeps why a post got no numbers on its job (never a
// snapshot). storedToken (not ""): Facebook refused the Page's token, so
// the Page needs a reconnect too, while it still holds that token.
func recordFailure(ctx context.Context, pool *database.Pool, next *claim, code, storedToken string) error {
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		const update = `
			UPDATE publish_jobs SET metrics_error = $3, metrics_attempted_at = COALESCE(metrics_attempted_at, now())
			WHERE company_id = $1 AND id = $2 AND status = 'published'`
		tag, err := tx.Exec(ctx, update, next.company.String(), next.jobID, code)
		if err != nil || tag.RowsAffected() == 0 || storedToken == "" {
			return err
		}
		marked, err := social.MarkNeedsReconnectWithin(ctx, tx, next.company, next.connectionID, storedToken, "token_rejected")
		if err != nil || !marked {
			return err
		}
		return publishing.RecordActivityWithin(ctx, tx, next.company, publishing.Activity{Action: "reconnect_needed", ConnectionID: next.connectionID, Code: "token_rejected"})
	})
}
