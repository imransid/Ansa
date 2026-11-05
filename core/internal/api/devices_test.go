package api

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/devices"
	"ansa/core/internal/session"
)

// The website's phone page: the QR code an owner shows, the list, the
// setting, removing a phone, and what Home says when the phones switched
// ansa away.
func TestThePhonesPageForOwners(t *testing.T) {
	w := newAPIWorld(t)
	w.api.DeviceAPIURL = "http://127.0.0.1:8080"
	code, page := w.call("GET", "/api/v1/devices", "", screensSecret, w.cookie)
	if code != 200 || len(page["devices"].([]any)) != 0 || page["followPhone"] != false || page["waitMinutes"] != 5.0 ||
		page["canChange"] != true || page["phoneAway"] != nil {
		t.Fatalf("the page before any phone: %d %v", code, page)
	}
	code, made := w.call("POST", "/api/v1/devices/pair-code", "{}", screensSecret, w.cookie)
	pairCode, _ := made["code"].(string)
	link, _ := made["link"].(string)
	qr, _ := made["qr"].(map[string]any)
	if code != 200 || len(pairCode) != 8 || link != "ansa://pair?u=http%3A%2F%2F127.0.0.1%3A8080&c="+pairCode || made["expiresAt"] == "" {
		t.Fatalf("a pair code: %d %v", code, made)
	}
	rows, _ := qr["rows"].([]any)
	if qr["size"] != float64(len(rows)) || len(rows[0].(string)) != len(rows) {
		t.Fatalf("the QR code's modules: %v", qr)
	}
	pairing, err := devices.Pair(context.Background(), w.pool, pairCode, devices.NewPhone{Name: "Rafa's iPhone", Platform: "ios"})
	if err != nil || pairing.Outcome != devices.Paired {
		t.Fatalf("pairing with the code: %+v %v", pairing, err)
	}
	_, page = w.call("GET", "/api/v1/devices", "", screensSecret, w.cookie)
	listed := page["devices"].([]any)[0].(map[string]any)
	if listed["id"] != pairing.Device.ID || listed["name"] != "Rafa's iPhone" || listed["platform"] != "ios" || listed["lastSeenAt"] != "" ||
		listed["reachable"] != true || listed["pairedAt"] == "" {
		t.Fatalf("the phone listed: %v", listed)
	}

	for _, bad := range []string{`{"followPhone":true,"waitMinutes":7}`, `{"waitMinutes":5}`, `{"followPhone":true,"waitMinutes":5,"companyId":"x"}`} {
		if code, _ := w.call("POST", "/api/v1/devices/settings", bad, screensSecret, w.cookie); code != 400 {
			t.Fatalf("%s: %d", bad, code)
		}
	}
	if code, answer := w.call("POST", "/api/v1/devices/settings", `{"followPhone":true,"waitMinutes":15}`, screensSecret, w.cookie); code != 200 || answer["outcome"] != "saved" {
		t.Fatalf("the setting: %d %v", code, answer)
	}
	w.must(`UPDATE assistant_settings SET away_since = now(), away_set_by = 'phone' WHERE company_id = $1`, w.company.String())
	_, page = w.call("GET", "/api/v1/devices", "", screensSecret, w.cookie)
	if page["followPhone"] != true || page["waitMinutes"] != 15.0 || page["phoneAway"].(map[string]any)["since"] == "" {
		t.Fatalf("followed, and away by the phone: %v", page)
	}
	_, home := w.call("GET", "/api/v1/home", "", screensSecret, w.cookie)
	presence := home["presence"].(map[string]any)
	if presence["awayBy"] != "phone" || presence["followPhone"] != true || presence["phoneWaitMinutes"] != 15.0 || presence["awaySince"] == nil {
		t.Fatalf("Home says the phone switched ansa away: %v", presence)
	}

	path := "/api/v1/devices/" + strings.ToUpper(pairing.Device.ID) + "/remove"
	if code, answer := w.call("POST", path, "{}", screensSecret, w.cookie); code != 200 || answer["outcome"] != "removed" {
		t.Fatalf("removed: %d %v", code, answer)
	}
	if code, answer := w.call("POST", path, "{}", screensSecret, w.cookie); code != 200 || answer["outcome"] != "changed" {
		t.Fatalf("removed already: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/devices/not-an-id/remove", "{}", screensSecret, w.cookie); code != 400 {
		t.Fatalf("not an id: %d", code)
	}
}

// Members read the page; only owners show a code, change the setting or
// remove a phone.
func TestMembersReadThePhonesPageOnly(t *testing.T) {
	w := newAPIWorld(t)
	member := database.TestOwner(t, w.pool, w.company.String())
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), member)
	token, _ := conversations.NewID()
	w.must(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, member)
	t.Cleanup(func() { w.pool.Exec(context.Background(), `DELETE FROM sessions WHERE token = $1`, token) })
	memberCookie := "better-auth.session_token=" + session.SignValue(token, authSecret)
	if code, page := w.call("GET", "/api/v1/devices", "", screensSecret, memberCookie); code != 200 || page["canChange"] != false {
		t.Fatalf("a member reads: %d %v", code, page)
	}
	id, _ := conversations.NewID()
	for path, body := range map[string]string{
		"/api/v1/devices/pair-code":         "{}",
		"/api/v1/devices/settings":          `{"followPhone":true,"waitMinutes":5}`,
		"/api/v1/devices/" + id + "/remove": "{}",
	} {
		if code, answer := w.call("POST", path, body, screensSecret, memberCookie); code != 403 || answer["error"] == "" {
			t.Fatalf("%s by a member: %d %v", path, code, answer)
		}
	}
}
