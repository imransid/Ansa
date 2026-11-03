package api

import (
	"testing"
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
