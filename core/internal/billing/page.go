package billing

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/packages"
	"ansa/core/internal/tenant"
)

// Mode is "stripe" (real payments: USE_STRIPE=true), "dev" (a developer's
// machine: nothing can be charged; the page offers buttons that pretend
// Stripe answered) or "off" (production without Stripe: the page only says
// billing isn't set up, never developer wording).
func Mode(useStripe, production bool) string {
	switch {
	case useStripe:
		return "stripe"
	case production:
		return "off"
	}
	return "dev"
}

// View is the Billing page (owners only).
type View struct {
	Mode         string    `json:"mode"`
	Subscription *Snapshot `json:"subscription"`
	IsLive       bool      `json:"isLive"`
	// Step 57: the package the company has now (the trial, a paid one, or
	// none), the paid ones it can choose, when the free trial ends, and
	// what it used this month.
	Package     packages.Package   `json:"package"`
	Packages    []packages.Package `json:"packages"`
	TrialEndsAt time.Time          `json:"trialEndsAt"`
	Usage       packages.Usage     `json:"usage"`
	// Back from a paid checkout whose webhook hasn't been stored yet.
	ConfirmingPayment bool `json:"confirmingPayment"`
	// Subscribe is offered: no live plan, and no payment being confirmed
	// (a second checkout then would charge twice).
	OffersCheckout bool `json:"offersCheckout"`
}

// ReadView reads the Billing page; justCheckedOut: opened by Stripe's
// "payment done" redirect.
func ReadView(ctx context.Context, pool *database.Pool, company tenant.CompanyID, mode string, justCheckedOut bool, now time.Time) (View, error) {
	subscription, err := Read(ctx, pool, company)
	if err != nil {
		return View{}, err
	}
	isLive := subscription != nil && IsLive(subscription.Status)
	confirming := justCheckedOut && !isLive
	view := View{Mode: mode, Subscription: subscription, IsLive: isLive, ConfirmingPayment: confirming, OffersCheckout: !isLive && !confirming, Packages: packages.Paid}
	if view.Package, err = packages.Of(ctx, pool, company, now); err != nil {
		return View{}, err
	}
	if err := pool.QueryRow(ctx, `SELECT trial_ends_at FROM companies WHERE id = $1`, company.String()).Scan(&view.TrialEndsAt); err != nil {
		return View{}, err
	}
	view.Usage, err = packages.ReadUsage(ctx, pool, company, now)
	return view, err
}

// Simulate pretends Stripe reported a status ("active", "past_due" or
// "canceled") for a package, so every Billing page state can be tried
// locally: dev mode only.
func Simulate(ctx context.Context, pool *database.Pool, company tenant.CompanyID, status, packageKey string, now time.Time) error {
	var end *time.Time
	if status != "canceled" {
		in30Days := now.Add(30 * 24 * time.Hour)
		end = &in30Days
	}
	_, err := Save(ctx, pool, company, Snapshot{CustomerID: "dev_cus_" + company.String(), SubscriptionID: "dev_sub_" + company.String(), Status: status, Package: packageKey, CurrentPeriodEnd: end})
	return err
}
