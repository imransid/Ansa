package analytics

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Reading one company's published posts with their numbers (the old
// db/post-metrics-reads.ts), for the Analytics page and the review: each
// post that went out in a period, with its newest snapshot. The company in
// every WHERE, and every join matches company_id too.

// LatestMetrics is a post's newest snapshot. Values holds every column;
// nil = the platform didn't give it (never 0).
type LatestMetrics struct {
	CollectedAt time.Time         `json:"collectedAt"`
	Source      string            `json:"source"`
	Values      map[string]*int64 `json:"values"`
}

// PublishedPost is one post that went out. Pillar "" = none; AccountName
// nil = the account is gone; HasPlatformID false = marked published by hand.
type PublishedPost struct {
	JobID              string         `json:"jobId"`
	DraftID            string         `json:"draftId"`
	Topic              string         `json:"topic"`
	Platform           string         `json:"platform"`
	Format             string         `json:"format"`
	Pillar             string         `json:"pillar"`
	AccountName        *string        `json:"accountName"`
	AccountIsStandIn   bool           `json:"accountIsStandIn"`
	PublishedAt        time.Time      `json:"publishedAt"`
	HasPlatformID      bool           `json:"hasPlatformId"`
	MetricsAttemptedAt *time.Time     `json:"metricsAttemptedAt"`
	MetricsError       *string        `json:"metricsError"`
	Latest             *LatestMetrics `json:"latest"`
}

// MetricsActivity: when the company's numbers were last tried, read from a
// platform, and simulated (nil = never).
type MetricsActivity struct {
	LastAttemptAt   *time.Time `json:"lastAttemptAt"`
	LastCollectedAt *time.Time `json:"lastCollectedAt"`
	LastSimulatedAt *time.Time `json:"lastSimulatedAt"`
}

// publishedPosts lists one company's posts that went out from `from` to
// `to`, newest first; onlyWithNumbers: those with a snapshot (what a
// review reads).
func publishedPosts(ctx context.Context, pool *database.Pool, company tenant.CompanyID, from, to time.Time, limit int, onlyWithNumbers bool) ([]PublishedPost, error) {
	// The newest snapshot through LATERAL: one index lookup per post.
	const statement = `
		SELECT jobs.id, jobs.draft_id, drafts.topic, drafts.platform, drafts.format, drafts.pillar,
			accounts.display_name, COALESCE(accounts.is_stand_in, false), jobs.published_at, jobs.external_post_id IS NOT NULL,
			jobs.metrics_attempted_at, jobs.metrics_error,
			latest.collected_at, latest.source, latest.views, latest.reach, latest.reactions, latest.comments, latest.shares, latest.clicks, latest.video_views
		FROM publish_jobs AS jobs
		JOIN content_drafts AS drafts ON drafts.company_id = jobs.company_id AND drafts.id = jobs.draft_id
		LEFT JOIN social_connections AS accounts ON accounts.company_id = jobs.company_id AND accounts.id = jobs.connection_id
		LEFT JOIN LATERAL (
			SELECT snapshots.collected_at, snapshots.source, snapshots.views, snapshots.reach, snapshots.reactions,
				snapshots.comments, snapshots.shares, snapshots.clicks, snapshots.video_views
			FROM post_metrics AS snapshots
			WHERE snapshots.company_id = $1 AND snapshots.publish_job_id = jobs.id
			ORDER BY snapshots.collected_at DESC, snapshots.created_at DESC
			LIMIT 1
		) AS latest ON true
		WHERE jobs.company_id = $1 AND jobs.status = 'published' AND jobs.published_at >= $2 AND jobs.published_at < $3
			AND (NOT $5::boolean OR latest.collected_at IS NOT NULL)
		ORDER BY jobs.published_at DESC, jobs.id DESC
		LIMIT $4`
	rows, err := pool.Query(ctx, statement, company.String(), from, to, limit, onlyWithNumbers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	posts := []PublishedPost{}
	for rows.Next() {
		post, err := scanPost(rows)
		if err != nil {
			return nil, err
		}
		posts = append(posts, post)
	}
	return posts, rows.Err()
}

func scanPost(rows interface{ Scan(...any) error }) (PublishedPost, error) {
	var post PublishedPost
	var publishedAt, collectedAt *time.Time
	var source *string
	values := make([]*int64, len(MetricColumns))
	targets := []any{&post.JobID, &post.DraftID, &post.Topic, &post.Platform, &post.Format, &post.Pillar,
		&post.AccountName, &post.AccountIsStandIn, &publishedAt, &post.HasPlatformID, &post.MetricsAttemptedAt, &post.MetricsError,
		&collectedAt, &source}
	for index := range values {
		targets = append(targets, &values[index])
	}
	if err := rows.Scan(targets...); err != nil {
		return post, err
	}
	// Every published post has its time (a CHECK); the epoch is never shown.
	post.PublishedAt = time.Unix(0, 0).UTC()
	if publishedAt != nil {
		post.PublishedAt = *publishedAt
	}
	if collectedAt != nil && source != nil {
		post.Latest = &LatestMetrics{CollectedAt: *collectedAt, Source: *source, Values: map[string]*int64{}}
		for index, column := range MetricColumns {
			post.Latest.Values[column] = values[index]
		}
	}
	return post, nil
}

// countPublished counts one company's posts that went out in the period,
// and how many of them have numbers.
func countPublished(ctx context.Context, pool *database.Pool, company tenant.CompanyID, from, to time.Time) (posts, withNumbers int, err error) {
	const statement = `
		SELECT count(*), count(*) FILTER (WHERE EXISTS (
			SELECT 1 FROM post_metrics AS snapshots WHERE snapshots.company_id = $1 AND snapshots.publish_job_id = jobs.id))
		FROM publish_jobs AS jobs
		WHERE jobs.company_id = $1 AND jobs.status = 'published' AND jobs.published_at >= $2 AND jobs.published_at < $3`
	err = pool.QueryRow(ctx, statement, company.String(), from, to).Scan(&posts, &withNumbers)
	return posts, withNumbers, err
}

// metricsActivity reads when one company's numbers were last tried, read
// from a platform, and simulated.
func metricsActivity(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (MetricsActivity, error) {
	const statement = `
		SELECT (SELECT max(metrics_attempted_at) FROM publish_jobs WHERE company_id = $1),
			(SELECT max(collected_at) FILTER (WHERE source = 'platform') FROM post_metrics WHERE company_id = $1),
			(SELECT max(collected_at) FILTER (WHERE source = 'dev_simulated') FROM post_metrics WHERE company_id = $1)`
	var activity MetricsActivity
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&activity.LastAttemptAt, &activity.LastCollectedAt, &activity.LastSimulatedAt)
	return activity, err
}
