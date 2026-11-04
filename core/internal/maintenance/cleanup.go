// Package maintenance is core's housekeeping (the old db/maintenance.ts and
// services/maintenance.ts): deleting rows nobody can use any more, by age
// alone. Nothing here reads a row. Each delete removes at most 10,000 rows
// in one statement and repeats until nothing is left or its table had 10
// seconds: a flood (millions of old rate limit counters) never makes one
// statement run so long that it is rolled back whole, and each finished
// batch stays done. The age test is repeated outside the batch's subquery,
// so a row that came back to life meanwhile is kept.
package maintenance

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
)

const (
	batchSize       = 10_000
	secondsPerTable = 10
)

// cleanups are the deletes, each with its reason. $1 is the batch size; a
// company's table also takes $2, a company to keep to ("" = every company:
// only the tests keep to theirs, and skip the tables of no company).
var cleanups = []struct {
	name, statement string
	ofACompany      bool
}{
	// Rate limit counters whose window started over 2 days ago: the longest
	// window is a day, kept a day longer so no live counter is reset even
	// if clocks disagree a little. Not a tenant table (keyed by an HMAC).
	{"rate limit counters", `
		DELETE FROM rate_limits WHERE key IN (
			SELECT key FROM rate_limits WHERE window_started_at < now() - interval '48 hours' LIMIT $1
		) AND window_started_at < now() - interval '48 hours'`, false},
	// Expired logins and password reset links (Better Auth's own tables):
	// refused anyway, this only frees space.
	{"sessions", `
		DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at < now() LIMIT $1) AND expires_at < now()`, false},
	{"reset links", `
		DELETE FROM verifications WHERE id IN (SELECT id FROM verifications WHERE expires_at < now() LIMIT $1) AND expires_at < now()`, false},
	// Social connection attempts past their 10 minutes, used or not: never accepted again.
	{"connection attempts", `
		-- cross-company: expired attempts are deleted by age alone; nothing is read.
		DELETE FROM oauth_states WHERE id IN (
			SELECT id FROM oauth_states WHERE expires_at < now() AND ($2 = '' OR company_id::text = $2) LIMIT $1
		) AND expires_at < now()`, true},
	// Telegram link codes past their 10 minutes and the hour a claimed one
	// waits for its connection: never accepted again.
	{"telegram link codes", `
		-- cross-company: used-up codes are deleted by age alone; nothing is read.
		DELETE FROM telegram_link_codes WHERE id IN (
			SELECT id FROM telegram_link_codes WHERE expires_at < now() - interval '60 minutes' AND ($2 = '' OR company_id::text = $2) LIMIT $1
		) AND expires_at < now() - interval '60 minutes'`, true},
	// The phone app's pair codes past their 5 minutes, used or not: never
	// accepted again (a phone keeps its own row).
	{"device pair codes", `
		-- cross-company: expired pair codes are deleted by age alone; nothing is read.
		DELETE FROM device_pair_codes WHERE id IN (
			SELECT id FROM device_pair_codes WHERE expires_at < now() AND ($2 = '' OR company_id::text = $2) LIMIT $1
		) AND expires_at < now()`, true},
	// Telegram accounts that waited their hour (and a code's 10 minutes) for
	// a code in vain. No company: Telegram's ids and a name only.
	{"telegram pending connections", `
		DELETE FROM telegram_pending_connections WHERE external_id IN (
			SELECT external_id FROM telegram_pending_connections WHERE received_at < now() - interval '70 minutes' LIMIT $1
		) AND received_at < now() - interval '70 minutes'`, false},
	// core's own finished jobs, 30 days after they ended (ids and codes only,
	// kept that long to look into a failure).
	{"finished jobs", `
		-- cross-company: finished jobs are deleted by age alone; nothing is read.
		DELETE FROM core_jobs WHERE id IN (
			SELECT id FROM core_jobs WHERE status IN ('done', 'failed') AND finished_at < now() - interval '30 days' AND ($2 = '' OR company_id::text = $2) LIMIT $1
		) AND status IN ('done', 'failed') AND finished_at < now() - interval '30 days'`, true},
}

// Cleanup runs every delete; it returns how many rows went. A table that
// still has old rows after its 10 seconds waits for the next run (logged).
// onlyCompany: the tests keep to their own company's rows.
func Cleanup(ctx context.Context, pool *database.Pool, log *logging.Logger, onlyCompany string) (int, error) {
	total := 0
	for _, cleanup := range cleanups {
		if onlyCompany != "" && !cleanup.ofACompany {
			continue
		}
		args := []any{batchSize}
		if cleanup.ofACompany {
			args = append(args, onlyCompany)
		}
		deadline := time.Now().Add(secondsPerTable * time.Second)
		for {
			tag, err := pool.Exec(ctx, cleanup.statement, args...)
			if err != nil {
				return total, err
			}
			total += int(tag.RowsAffected())
			if tag.RowsAffected() < batchSize {
				break
			}
			if time.Now().After(deadline) {
				log.Warn("maintenance: cleanup stopped at its time limit, the rest waits for the next run", logging.Code(codeOf(cleanup.name)))
				break
			}
		}
	}
	return total, nil
}

// codeOf is a table's name as a log code.
func codeOf(name string) string {
	code := []rune(name)
	for i, r := range code {
		if r == ' ' {
			code[i] = '_'
		}
	}
	return string(code)
}
