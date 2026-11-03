package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

const secret = "whsec_test_secret"

func sign(body []byte, at time.Time) string {
	stamp := strconv.FormatInt(at.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(stamp + "." + string(body)))
	return "t=" + stamp + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

func TestOnlyStripesFreshSignatureCounts(t *testing.T) {
	body := []byte(`{"type":"x"}`)
	now := time.Now()
	if !SignedByStripe(body, sign(body, now), secret, now) {
		t.Fatal("a fresh signature")
	}
	if SignedByStripe(body, sign(body, now.Add(-6*time.Minute)), secret, now) {
		t.Fatal("an old one is a replay")
	}
	if SignedByStripe([]byte(`{"type":"y"}`), sign(body, now), secret, now) || SignedByStripe(body, sign(body, now), "", now) {
		t.Fatal("other bytes, or no secret")
	}
}

func TestBillingNeverMovesBetweenCompanies(t *testing.T) {
	for _, c := range []struct{ checkout, metadata, owner, want, ignored string }{
		{"", "c1", "", "", "customer_not_known_yet"},
		{"11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "", "", "checkout_and_subscription_disagree"},
		{"11111111-1111-4111-8111-111111111111", "", "", "11111111-1111-4111-8111-111111111111", ""},
		{"", "", "33333333-3333-4333-8333-333333333333", "33333333-3333-4333-8333-333333333333", ""},
		{"11111111-1111-4111-8111-111111111111", "", "33333333-3333-4333-8333-333333333333", "", "customer_belongs_to_another_company"},
	} {
		got, ignored := chooseCompany(c.checkout, c.metadata, c.owner)
		if got != c.want || ignored != c.ignored {
			t.Errorf("%+v: got %q %q", c, got, ignored)
		}
	}
}

type fakeStripe struct{ answer Retrieved }

func (f *fakeStripe) Subscription(context.Context, string) (Retrieved, error) { return f.answer, nil }

func TestAPaidCheckoutIsStoredForItsCompanyAndASecondPlanIsNot(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	stripe := &fakeStripe{answer: Retrieved{Snapshot: Snapshot{CustomerID: "cus_" + companyID, SubscriptionID: "sub_1_" + companyID, Status: "active", Package: ""}, MetadataCompanyID: companyID}}
	limiter := ratelimit.New(pool, "billing-test-secret")
	hook := &Webhook{Pool: pool, Limiter: limiter, Log: logging.New(io.Discard), Secret: secret, Stripe: stripe}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("stripe-webhook", "192.0.2.1"))
	})
	send := func(body string) int {
		request := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", bytes.NewReader([]byte(body)))
		request.Header.Set("Stripe-Signature", sign([]byte(body), time.Now()))
		recorder := httptest.NewRecorder()
		hook.ServeHTTP(recorder, request)
		return recorder.Code
	}
	if code := send(`{"type":"customer.subscription.updated","data":{"object":{"id":"sub_1_` + companyID + `"}}}`); code != 200 {
		t.Fatalf("answered: %d", code)
	}
	if stored, _ := Read(ctx, pool, company); stored != nil {
		t.Fatal("a customer no company owns yet gets nothing from a subscription event")
	}
	checkout := `{"type":"checkout.session.completed","data":{"object":{"mode":"subscription","client_reference_id":"` + companyID + `","subscription":"sub_1_` + companyID + `"}}}`
	if code := send(checkout); code != 200 {
		t.Fatalf("checkout: %d", code)
	}
	if stored, _ := Read(ctx, pool, company); stored != nil {
		t.Fatal("a price none of ansa's packages has stores nothing")
	}
	stripe.answer.Snapshot.Package = "pro"
	send(checkout)
	if stored, _ := Read(ctx, pool, company); stored == nil || stored.Status != "active" || stored.Package != "pro" {
		t.Fatalf("stored with its package: %+v", stored)
	}
	stripe.answer.Snapshot.SubscriptionID = "sub_2_" + companyID
	send(`{"type":"customer.subscription.created","data":{"object":{"id":"sub_2_` + companyID + `"}}}`)
	if stored, _ := Read(ctx, pool, company); stored.SubscriptionID != "sub_1_"+companyID {
		t.Fatal("a second live plan never replaces the first")
	}
	view, _ := ReadView(ctx, pool, company, "dev", false, time.Now())
	if !view.IsLive || view.OffersCheckout || view.Package.Key != "pro" || len(view.Packages) != 3 {
		t.Fatalf("page: %+v", view)
	}
	pool.Exec(ctx, `DELETE FROM company_billing WHERE company_id = $1`, companyID)
	if err := Simulate(ctx, pool, company, "past_due", "personal", time.Now()); err != nil {
		t.Fatalf("simulate: %v", err)
	}
	if view, _ := ReadView(ctx, pool, company, "dev", true, time.Now()); view.Subscription.Status != "past_due" || view.Package.Key != "personal" {
		t.Fatal("simulated: a payment Stripe still retries keeps the package")
	}
}
