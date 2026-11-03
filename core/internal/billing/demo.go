package billing

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/packages"
	"ansa/core/internal/tenant"
)

// The development Billing page's demo steps (dev mode only, like
// Simulate): each puts the company where a demo needs it, so the free
// trial's end, the month's limits and a payment's life can be shown without
// waiting two weeks or paying anything.
const (
	DemoTrialEnded        = "trial_ended"
	DemoAIRepliesUsedUp   = "ai_replies_used_up"
	DemoCallMinutesUsedUp = "call_minutes_used_up"
	DemoPaymentFixed      = "payment_fixed"
	DemoCancelAtPeriodEnd = "cancel_at_period_end"
	DemoBackToNormal      = "back_to_normal"
)

// What a demo step ended in.
const (
	DemoSaved = "saved"
	// Payment fixed: no subscription whose payment failed.
	DemoNoFailedPayment = "no-failed-payment"
	// Cancel at the end of the period: no live subscription.
	DemoNoSubscription = "no-subscription"
	DemoUnknown        = "unknown"
)

// SimulateDemo runs one demo step for the company (dev mode only).
func SimulateDemo(ctx context.Context, pool *database.Pool, company tenant.CompanyID, step string, now time.Time) (string, error) {
	switch step {
	case DemoTrialEnded:
		return endTrialNow(ctx, pool, company, now)
	case DemoAIRepliesUsedUp:
		return useUpAIReplies(ctx, pool, company, now)
	case DemoCallMinutesUsedUp:
		return useUpCallMinutes(ctx, pool, company, now)
	case DemoPaymentFixed:
		return fixFailedPayment(ctx, pool, company)
	case DemoCancelAtPeriodEnd:
		return cancelAtPeriodEnd(ctx, pool, company, now)
	case DemoBackToNormal:
		return backToNormal(ctx, pool, company, now)
	}
	return DemoUnknown, nil
}

// endTrialNow ends the free trial at this moment (by the clock the package
// is read with, so the page right after already shows it ended).
func endTrialNow(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (string, error) {
	_, err := pool.Exec(ctx, `UPDATE companies SET trial_ends_at = $2 WHERE id = $1`, company.String(), now)
	return DemoSaved, err
}

// useUpAIReplies counts this month's AI replies up to the package's limit.
func useUpAIReplies(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (string, error) {
	pkg, err := packages.Of(ctx, pool, company, now)
	if err != nil {
		return "", err
	}
	const upsert = `
		INSERT INTO usage_months (company_id, month, ai_replies) VALUES ($1, $2, $3)
		ON CONFLICT (company_id, month) DO UPDATE SET ai_replies = EXCLUDED.ai_replies, updated_at = now()`
	_, err = pool.Exec(ctx, upsert, company.String(), packages.Month(now), pkg.AIReplies)
	return DemoSaved, err
}

// useUpCallMinutes counts this month's call time up to the package's minutes.
func useUpCallMinutes(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (string, error) {
	pkg, err := packages.Of(ctx, pool, company, now)
	if err != nil {
		return "", err
	}
	const upsert = `
		INSERT INTO usage_months (company_id, month, call_seconds) VALUES ($1, $2, $3)
		ON CONFLICT (company_id, month) DO UPDATE SET call_seconds = EXCLUDED.call_seconds, updated_at = now()`
	_, err = pool.Exec(ctx, upsert, company.String(), packages.Month(now), pkg.CallMinutes*60)
	return DemoSaved, err
}

// fixFailedPayment: Stripe took the payment it was retrying, so the
// subscription is active again on the same package.
func fixFailedPayment(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (string, error) {
	const statement = `UPDATE company_billing SET status = 'active', updated_at = now() WHERE company_id = $1 AND status IN ('past_due', 'unpaid')`
	tag, err := pool.Exec(ctx, statement, company.String())
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return DemoNoFailedPayment, nil
	}
	return DemoSaved, nil
}

// cancelAtPeriodEnd: the owner canceled in Stripe's portal, so the
// subscription stays live until its paid period ends (the page then says
// "Ends on").
func cancelAtPeriodEnd(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (string, error) {
	in30Days := now.Add(30 * 24 * time.Hour)
	const statement = `
		UPDATE company_billing SET cancel_at_period_end = true, current_period_end = COALESCE(current_period_end, $2), updated_at = now()
		WHERE company_id = $1 AND status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused')`
	tag, err := pool.Exec(ctx, statement, company.String(), in30Days)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return DemoNoSubscription, nil
	}
	return DemoSaved, nil
}

// backToNormal puts the company back as signup left it, in one
// transaction: the free trial's 14 days from its signup, nothing used this
// month, and no subscription.
func backToNormal(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (string, error) {
	return DemoSaved, database.InTx(ctx, pool, func(tx database.Tx) error {
		// WHY hours, not days: an interval of days follows the session's time
		// zone across a clock change; the trial is 14 x 24 hours.
		const trial = `UPDATE companies SET trial_ends_at = created_at + make_interval(hours => $2) WHERE id = $1`
		if _, err := tx.Exec(ctx, trial, company.String(), packages.TrialDays*24); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM usage_months WHERE company_id = $1 AND month = $2`, company.String(), packages.Month(now)); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM company_billing WHERE company_id = $1`, company.String())
		return err
	})
}
