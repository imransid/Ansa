package billing

import (
	"context"
	"time"

	"ansa/core/internal/database"
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
	// Back from a paid checkout whose webhook hasn't been stored yet.
	ConfirmingPayment bool `json:"confirmingPayment"`
	// Subscribe is offered: no live plan, and no payment being confirmed
	// (a second checkout then would charge twice).
	OffersCheckout bool `json:"offersCheckout"`
}

// ReadView reads the Billing page; justCheckedOut: opened by Stripe's
// "payment done" redirect.
func ReadView(ctx context.Context, pool *database.Pool, company tenant.CompanyID, mode string, justCheckedOut bool) (View, error) {
	subscription, err := Read(ctx, pool, company)
	if err != nil {
		return View{}, err
	}
	isLive := subscription != nil && IsLive(subscription.Status)
	confirming := justCheckedOut && !isLive
	return View{Mode: mode, Subscription: subscription, IsLive: isLive, ConfirmingPayment: confirming, OffersCheckout: !isLive && !confirming}, nil
}

// Simulate pretends Stripe reported a status ("active", "past_due" or
// "canceled"), so every Billing page state can be tried locally: dev mode only.
func Simulate(ctx context.Context, pool *database.Pool, company tenant.CompanyID, status string, now time.Time) error {
	var end *time.Time
	if status != "canceled" {
		in30Days := now.Add(30 * 24 * time.Hour)
		end = &in30Days
	}
	_, err := Save(ctx, pool, company, Snapshot{CustomerID: "dev_cus_" + company.String(), SubscriptionID: "dev_sub_" + company.String(), Status: status, CurrentPeriodEnd: end})
	return err
}
