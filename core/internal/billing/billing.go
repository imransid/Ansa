// Package billing is Billing (the old services/billing.ts,
// services/stripe-webhook.ts, db/billing.ts, adapters/stripe.ts): one
// subscription per company, kept as Stripe has it, written ONLY from
// Stripe's signed webhooks (or the development stand-in), never from what a
// browser sends. It records who pays and enforces nothing yet (a choice for
// the owner: packages and limits).
package billing

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Snapshot is a subscription as stored (company_billing).
type Snapshot struct {
	CustomerID        string     `json:"-"`
	SubscriptionID    string     `json:"-"`
	Status            string     `json:"status"`
	CurrentPeriodEnd  *time.Time `json:"currentPeriodEnd"`
	CancelAtPeriodEnd bool       `json:"cancelAtPeriodEnd"`
}

// live: the company still has (or is about to have) a working plan.
var live = map[string]bool{"trialing": true, "active": true, "past_due": true, "unpaid": true, "paused": true}

// IsLive says whether a status still holds a working plan.
func IsLive(status string) bool { return live[status] }

// Read is a company's subscription (nil: it never subscribed).
func Read(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (*Snapshot, error) {
	var s Snapshot
	const statement = `
		SELECT stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end
		FROM company_billing WHERE company_id = $1`
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&s.CustomerID, &s.SubscriptionID, &s.Status, &s.CurrentPeriodEnd, &s.CancelAtPeriodEnd)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

// Save keeps the latest state of a company's subscription. A DIFFERENT
// subscription replaces the stored one only when that one is no longer
// live (a late "old subscription canceled" can't undo a new one). Every
// column named: the company only ever comes from the argument. False: not
// saved for that reason.
func Save(ctx context.Context, pool *database.Pool, company tenant.CompanyID, s Snapshot) (bool, error) {
	const upsert = `
		INSERT INTO company_billing (company_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end)
		VALUES ($1, $2, $3, $4::subscription_status, $5, $6)
		ON CONFLICT (company_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id,
			stripe_subscription_id = EXCLUDED.stripe_subscription_id, status = EXCLUDED.status,
			current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end, updated_at = now()
		WHERE company_billing.company_id = $1 AND (company_billing.stripe_subscription_id = $3
			OR company_billing.status NOT IN ('trialing', 'active', 'past_due', 'unpaid', 'paused'))`
	tag, err := pool.Exec(ctx, upsert, company.String(), s.CustomerID, s.SubscriptionID, s.Status, s.CurrentPeriodEnd, s.CancelAtPeriodEnd)
	return tag.RowsAffected() == 1, err
}

// companyOfCustomer is the company that owns a Stripe customer ("" for
// none). Read only after a webhook's signature checked out.
func companyOfCustomer(ctx context.Context, pool *database.Pool, customerID string) (string, error) {
	var company string
	const statement = `
		-- cross-company: a Stripe customer belongs to one company; only its id is read, after Stripe's signature checked out.
		SELECT company_id FROM company_billing WHERE stripe_customer_id = $1`
	err := pool.QueryRow(ctx, statement, customerID).Scan(&company)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return company, err
}
