package billing

import (
	"context"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/packages"
	"ansa/core/internal/tenant"
)

// Each development demo step puts the company where a demo needs it: the
// trial's end, the month's AI replies or call minutes used up, a failed
// payment fixed, a cancel at the period's end, and back to how signup left
// it.
func TestTheDemoStepsPutTheCompanyWhereADemoNeedsIt(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	step := func(name, want string) View {
		t.Helper()
		outcome, err := SimulateDemo(ctx, pool, company, name, time.Now())
		if err != nil || outcome != want {
			t.Fatalf("%s: %s %v", name, outcome, err)
		}
		view, err := ReadView(ctx, pool, company, "dev", false, time.Now())
		if err != nil {
			t.Fatalf("%s: the page: %v", name, err)
		}
		return view
	}

	if view := step(DemoAIRepliesUsedUp, DemoSaved); view.Usage.AIReplies != packages.Trial.AIReplies {
		t.Fatalf("the trial's AI replies used up: %+v", view.Usage)
	}
	if taken, _ := packages.TakeAIReply(ctx, pool, company, time.Now()); taken {
		t.Fatal("no AI reply left")
	}
	if view := step(DemoCallMinutesUsedUp, DemoSaved); view.Usage.CallSeconds != packages.Trial.CallMinutes*60 {
		t.Fatalf("the trial's call minutes used up: %+v", view.Usage)
	}
	if left, _ := packages.CallTimeLeft(ctx, pool, company, time.Now(), 0); left {
		t.Fatal("no call time left")
	}
	if view := step(DemoTrialEnded, DemoSaved); view.Package.Key != packages.None.Key {
		t.Fatalf("the trial ended: %s", view.Package.Key)
	}
	step(DemoPaymentFixed, DemoNoFailedPayment)
	step(DemoCancelAtPeriodEnd, DemoNoSubscription)

	if err := Simulate(ctx, pool, company, "past_due", "business", time.Now()); err != nil {
		t.Fatalf("a failed payment: %v", err)
	}
	if view := step(DemoPaymentFixed, DemoSaved); view.Subscription.Status != "active" || view.Package.Key != "business" {
		t.Fatalf("the payment fixed, the same package: %+v %s", view.Subscription, view.Package.Key)
	}
	view := step(DemoCancelAtPeriodEnd, DemoSaved)
	if !view.Subscription.CancelAtPeriodEnd || view.Subscription.CurrentPeriodEnd == nil || !view.IsLive || view.Package.Key != "business" {
		t.Fatalf("ends at the period's end, live until then: %+v", view.Subscription)
	}

	view = step(DemoBackToNormal, DemoSaved)
	var signedUpAt time.Time
	if err := pool.QueryRow(ctx, `SELECT created_at FROM companies WHERE id = $1`, companyID).Scan(&signedUpAt); err != nil {
		t.Fatalf("created: %v", err)
	}
	if view.Subscription != nil || view.Package.Key != packages.Trial.Key || view.Usage != (packages.Usage{}) ||
		!view.TrialEndsAt.Equal(signedUpAt.Add(packages.TrialDays*24*time.Hour)) {
		t.Fatalf("the trial as at signup, nothing used, no billing: %+v", view)
	}
	step("gold", DemoUnknown)
}
