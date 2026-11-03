package api

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/session"
)

// Billing (step 57): a new company is on the free trial; checkout needs one
// of ansa's packages; in development a simulated package becomes the
// company's.
func TestBillingShowsThePackageAndItsUse(t *testing.T) {
	w := newAPIWorld(t)
	w.serverAPI().BillingMode = "dev"
	code, answer := w.call("GET", "/api/v1/billing", "", screensSecret, w.cookie)
	view, _ := answer["billing"].(map[string]any)
	pkg, _ := view["package"].(map[string]any)
	if code != 200 || pkg["key"] != "trial" || len(view["packages"].([]any)) != 3 || view["usage"] == nil {
		t.Fatalf("the free trial and the three packages: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/billing/checkout", `{"package":"gold"}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("only ansa's packages: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/billing/simulate", `{"status":"active","package":"pro"}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("simulated: %d", code)
	}
	_, answer = w.call("GET", "/api/v1/billing", "", screensSecret, w.cookie)
	if answer["billing"].(map[string]any)["package"].(map[string]any)["key"] != "pro" {
		t.Fatalf("Pro now: %v", answer)
	}
	_, home := w.call("GET", "/api/v1/home", "", screensSecret, w.cookie)
	if status, _ := home["package"].(map[string]any); status["package"].(map[string]any)["key"] != "pro" {
		t.Fatalf("Home tells owners: %v", home["package"])
	}
}

// The development Billing page's demo steps (the trial's end, the limits, a
// payment's life, back to normal): owners only, and only in development,
// exactly like the other simulate buttons.
func TestTheBillingDemoStepsAreForDevelopmentOnly(t *testing.T) {
	w := newAPIWorld(t)
	server := w.serverAPI()
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, server.Limiter.Key("billing", w.ownerID()))
	})
	demo := func(step, cookie string) (int, map[string]any) {
		return w.call("POST", "/api/v1/billing/demo", `{"step":"`+step+`"}`, screensSecret, cookie)
	}
	packageNow := func() string {
		_, answer := w.call("GET", "/api/v1/billing", "", screensSecret, w.cookie)
		view, _ := answer["billing"].(map[string]any)
		pkg, _ := view["package"].(map[string]any)
		return pkg["key"].(string)
	}
	for _, mode := range []string{"stripe", "off"} {
		server.BillingMode = mode
		if code, answer := demo("trial_ended", w.cookie); code != 409 || answer["error"] != "Simulating payments is only possible in development." {
			t.Fatalf("%s: %d %v", mode, code, answer)
		}
	}
	server.BillingMode = "dev"
	if packageNow() != "trial" {
		t.Fatal("refused: still the trial")
	}
	if code, _ := demo("gold", w.cookie); code != 400 {
		t.Fatalf("an unknown step: %d", code)
	}
	if code, answer := demo("payment_fixed", w.cookie); code != 409 || answer["error"] == nil {
		t.Fatalf("no failed payment to fix: %d %v", code, answer)
	}
	if code, answer := demo("trial_ended", w.cookie); code != 200 || answer["outcome"] != "saved" || packageNow() != "none" {
		t.Fatalf("the trial ended: %d %v", code, answer)
	}
	if code, _ := demo("back_to_normal", w.cookie); code != 200 || packageNow() != "trial" {
		t.Fatalf("back to normal: %d", code)
	}
	member := database.TestOwner(t, w.pool, w.company.String())
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), member)
	token, _ := conversations.NewID()
	w.must(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, member)
	t.Cleanup(func() { w.pool.Exec(context.Background(), `DELETE FROM sessions WHERE token = $1`, token) })
	if code, _ := demo("trial_ended", "better-auth.session_token="+session.SignValue(token, authSecret)); code != 403 || packageNow() != "trial" {
		t.Fatalf("members can't: %d", code)
	}
}
