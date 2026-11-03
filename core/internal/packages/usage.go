package packages

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/tenant"
)

// reader is a pool or a transaction.
type reader interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// LiveStatuses are the Stripe subscription statuses that still hold a
// package (Stripe retries a failed payment for a while: past_due keeps it).
var LiveStatuses = map[string]bool{"trialing": true, "active": true, "past_due": true, "unpaid": true, "paused": true}

// Of is the company's package now: its paid package while its subscription
// is live, else the free trial until it ends, else None.
func Of(ctx context.Context, db reader, company tenant.CompanyID, now time.Time) (Package, error) {
	const statement = `
		SELECT companies.trial_ends_at, COALESCE(company_billing.status::text, ''), COALESCE(company_billing.package, '')
		FROM companies
		LEFT JOIN company_billing ON company_billing.company_id = companies.id
		WHERE companies.id = $1`
	var trialEnds time.Time
	var status, key string
	if err := db.QueryRow(ctx, statement, company.String()).Scan(&trialEnds, &status, &key); err != nil {
		return None, err
	}
	if paid, known := ByKey(key); known && LiveStatuses[status] {
		return paid, nil
	}
	if now.Before(trialEnds) {
		return Trial, nil
	}
	return None, nil
}

// Month is the calendar month (UTC) a moment counts in: its first day.
func Month(now time.Time) time.Time {
	year, month, _ := now.UTC().Date()
	return time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
}

// Usage is what a company used in one month.
type Usage struct {
	AIReplies   int `json:"aiReplies"`
	CallSeconds int `json:"callSeconds"`
}

// ReadUsage is the company's use of the month `now` is in.
func ReadUsage(ctx context.Context, db reader, company tenant.CompanyID, now time.Time) (Usage, error) {
	var u Usage
	const statement = `SELECT ai_replies, call_seconds FROM usage_months WHERE company_id = $1 AND month = $2`
	err := db.QueryRow(ctx, statement, company.String(), Month(now)).Scan(&u.AIReplies, &u.CallSeconds)
	if errors.Is(err, pgx.ErrNoRows) {
		return Usage{}, nil
	}
	return u, err
}

// TakeAIReply counts one reply written with ansa's AI this month, when the
// company's package still has one; false = used up (nothing counted). One
// statement: two at once never count past the limit.
func TakeAIReply(ctx context.Context, db reader, company tenant.CompanyID, now time.Time) (bool, error) {
	pkg, err := Of(ctx, db, company, now)
	if err != nil || pkg.AIReplies <= 0 {
		return false, err
	}
	const statement = `
		INSERT INTO usage_months (company_id, month, ai_replies) VALUES ($1, $2, 1)
		ON CONFLICT (company_id, month) DO UPDATE SET ai_replies = usage_months.ai_replies + 1, updated_at = now()
		WHERE usage_months.ai_replies < $3
		RETURNING ai_replies`
	var count int
	err = db.QueryRow(ctx, statement, company.String(), Month(now), pkg.AIReplies).Scan(&count)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// CallTimeLeft: whether the company's package still has call minutes this
// month, counting the live call's seconds so far.
func CallTimeLeft(ctx context.Context, db reader, company tenant.CompanyID, now time.Time, liveSeconds int) (bool, error) {
	pkg, err := Of(ctx, db, company, now)
	if err != nil || pkg.CallMinutes <= 0 {
		return false, err
	}
	used, err := ReadUsage(ctx, db, company, now)
	if err != nil {
		return false, err
	}
	return used.CallSeconds+liveSeconds < pkg.CallMinutes*60, nil
}

// AddCallSecondsWithin counts a finished call's length, in the month it
// started (inside the transaction that ends the call: counted once).
func AddCallSecondsWithin(ctx context.Context, tx pgx.Tx, company tenant.CompanyID, startedAt time.Time, seconds int) error {
	if seconds <= 0 {
		return nil
	}
	if seconds > 24*60*60 {
		seconds = 24 * 60 * 60
	}
	const statement = `
		INSERT INTO usage_months (company_id, month, call_seconds) VALUES ($1, $2, $3)
		ON CONFLICT (company_id, month) DO UPDATE SET call_seconds = usage_months.call_seconds + EXCLUDED.call_seconds, updated_at = now()`
	_, err := tx.Exec(ctx, statement, company.String(), Month(startedAt), seconds)
	return err
}

// TeamSeatLeftWithin: whether the company's package has room for one more
// person (active people and pending invites counted). Read in the invite's
// own transaction; two invites at the very same moment can pass by one.
func TeamSeatLeftWithin(ctx context.Context, tx pgx.Tx, company tenant.CompanyID, now time.Time) (bool, error) {
	pkg, err := Of(ctx, tx, company, now)
	if err != nil {
		return false, err
	}
	const statement = `
		SELECT (SELECT count(*) FROM users WHERE company_id = $1 AND deactivated_at IS NULL)
			+ (SELECT count(*) FROM invites WHERE company_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())`
	var taken int
	if err := tx.QueryRow(ctx, statement, company.String()).Scan(&taken); err != nil {
		return false, err
	}
	return taken < pkg.TeamMembers, nil
}
