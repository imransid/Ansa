package api

import (
	"context"
	"testing"
)

// The reads the screens needed to leave the old backend completely.
func TestTheScreensGetEverythingTheyShowFromCore(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	t.Cleanup(func() {
		w.pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("settings-changes", w.ownerID()))
	})

	code, page := w.call("GET", "/api/v1/home", "", screensSecret, w.cookie)
	presence, _ := page["presence"].(map[string]any)
	overview, _ := page["overview"].(map[string]any)
	if _, hasAwaySince := presence["awaySince"]; code != 200 || !hasAwaySince || overview["support"] == nil || page["undeliveredEmails"] != 0.0 || page["handlesNoCategory"] != false {
		t.Fatalf("home: %d %+v", code, page)
	}
	code, glance := w.call("GET", "/api/v1/glance", "", screensSecret, w.cookie)
	if inner, _ := glance["glance"].(map[string]any); code != 200 || inner["companyName"] != "core test company" || inner["mode"] != "Answers on its own" {
		t.Fatalf("glance: %d %+v", code, glance)
	}
	code, emails := w.call("GET", "/api/v1/emails", "", screensSecret, w.cookie)
	if code != 200 || emails["total"] != 0.0 || emails["undeliveredTotal"] != 0.0 {
		t.Fatalf("emails: %d %+v", code, emails)
	}
	code, channels := w.call("GET", "/api/v1/channels", "", screensSecret, w.cookie)
	if code != 200 || channels["facebookMode"] != "stand-in" {
		t.Fatalf("channels: %d %+v", code, channels)
	}
	if code, answer := w.call("POST", "/api/v1/settings/support/company-name", `{"companyName":"A"}`, screensSecret, w.cookie); code != 400 || answer["fields"] == nil {
		t.Fatalf("a one-letter name: %d %+v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/settings/support/company-name", `{"companyName":" Bella Napoli "}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("rename: %d", code)
	}
	var name string
	w.pool.QueryRow(ctx, `SELECT name FROM companies WHERE id = $1`, w.company.String()).Scan(&name)
	if name != "Bella Napoli" {
		t.Fatalf("renamed: %q", name)
	}
	code, support := w.call("GET", "/api/v1/settings/support", "", screensSecret, w.cookie)
	if _, has := support["lastEmail"]; code != 200 || !has {
		t.Fatalf("support page: %d %+v", code, support)
	}
}
