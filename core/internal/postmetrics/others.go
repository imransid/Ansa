package postmetrics

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/platforms"
)

// collectOther reads one claimed X or YouTube post: its account made ready
// (renewed first; one that needs a reconnect, was disconnected or can't be
// used now is skipped with why, nothing asked), the platform asked once,
// the answer saved. The codes are the old collector's.
func (c *Collector) collectOther(ctx context.Context, next *claim) error {
	if c.Renewer == nil || c.Platforms == nil {
		return recordFailure(ctx, c.Pool, next, "not_set_up", "")
	}
	prepared, err := c.Renewer.Prepare(ctx, next.company, next.connectionID)
	if err != nil {
		return err
	}
	if code := skipCode(prepared.Kind, prepared.Code); code != "" {
		c.Log.Warn("post metrics: skipped", logging.Code(code))
		return recordFailure(ctx, c.Pool, next, code, "")
	}
	numbers, failure := c.Platforms.ReadNumbers(ctx, next.platform, prepared.IsStandIn, prepared.Target(), next.postID, next.publishedAt)
	if failure == "" {
		return saveAllNumbers(ctx, c.Pool, next, numbers)
	}
	c.Log.Warn("post metrics: not collected", logging.Code(failure))
	storedToken := ""
	if failure == "token_rejected" {
		storedToken = prepared.StoredToken
	}
	return recordFailure(ctx, c.Pool, next, failure, storedToken)
}

// skipCode is why an account that isn't ready gets no read ("" = ready).
func skipCode(kind, code string) string {
	switch {
	case kind == "ready":
		return ""
	case kind == "needs_reauth":
		return "reauthorization_needed"
	case kind == "disconnected", kind == "not_found":
		return "account_disconnected"
	case code == "not_set_up":
		return "not_set_up"
	case code == "token_unreadable":
		return "account_unreadable"
	}
	return "token_refresh_unavailable"
}

// saveAllNumbers saves a snapshot of every column the platform gave (nil =
// it didn't: NULL, never 0) and clears the last failure, in one transaction.
func saveAllNumbers(ctx context.Context, pool *database.Pool, next *claim, numbers platforms.Numbers) error {
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		const clear = `UPDATE publish_jobs SET metrics_error = NULL WHERE company_id = $1 AND id = $2 AND status = 'published'`
		tag, err := tx.Exec(ctx, clear, next.company.String(), next.jobID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		const insert = `
			INSERT INTO post_metrics (company_id, publish_job_id, collected_at, views, reach, reactions, comments, shares, clicks, video_views, source)
			VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9, 'platform')`
		_, err = tx.Exec(ctx, insert, next.company.String(), next.jobID, numbers.Views, numbers.Reach, numbers.Reactions, numbers.Comments,
			numbers.Shares, numbers.Clicks, numbers.VideoViews)
		return err
	})
}
