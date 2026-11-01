package ratelimit

import (
	"context"
	"time"

	"ansa/core/internal/database"
)

// recordAttempt counts one attempt in a single statement (read and write
// together, so two requests at once can't both see the old count) and
// returns the attempts in the current window. A window that ran out starts again.
func recordAttempt(ctx context.Context, pool *database.Pool, key string, window time.Duration) (int, error) {
	const statement = `
		INSERT INTO rate_limits (key, attempt_count, window_started_at)
		VALUES ($1, 1, now())
		ON CONFLICT (key) DO UPDATE SET
			attempt_count = CASE WHEN rate_limits.window_started_at < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.attempt_count + 1 END,
			window_started_at = CASE WHEN rate_limits.window_started_at < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_started_at END
		RETURNING attempt_count`
	var count int
	err := pool.QueryRow(ctx, statement, key, window.Seconds()).Scan(&count)
	return count, err
}

func removeAttempt(ctx context.Context, pool *database.Pool, key string) error {
	const statement = `UPDATE rate_limits SET attempt_count = GREATEST(attempt_count - 1, 0) WHERE key = $1`
	_, err := pool.Exec(ctx, statement, key)
	return err
}
