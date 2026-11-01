package api

import (
	"testing"
)

func TestPostForMeThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	code, answer := w.call("GET", "/api/v1/settings/posts", "", screensSecret, w.cookie)
	page := answer["page"].(map[string]any)
	if code != 200 || page["enabled"] != false || page["frequency"] != "three_a_week" || answer["canManage"] != true {
		t.Fatalf("the page: %d %v", code, answer)
	}
	automatic := `{"enabled":true,"frequency":"daily","time":"11:00","mode":"automatic","understood":false}`
	if code, answer := w.call("POST", "/api/v1/settings/posts", automatic, screensSecret, w.cookie); code != 400 || answer["fields"].(map[string]any)["understood"] == nil {
		t.Fatalf("Automatic needs the owner's tick: %d %v", code, answer)
	}
	understood := `{"enabled":true,"frequency":"daily","time":"11:00","mode":"automatic","understood":true}`
	if code, _ := w.call("POST", "/api/v1/settings/posts", understood, screensSecret, w.cookie); code != 409 {
		t.Fatalf("no time zone yet: %d", code)
	}
	w.must(`INSERT INTO assistant_settings (company_id, currency, time_zone, opening_hours) VALUES ($1, 'EUR', 'Europe/Rome', '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}')`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/settings/posts", understood, screensSecret, w.cookie); code != 200 {
		t.Fatalf("saved: %d", code)
	}
	if w.count(`SELECT count(*) FROM autopublish_rules WHERE company_id = $1 AND enabled`) != 1 {
		t.Fatal("the owner's Facebook rule is on")
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/settings/posts", understood, screensSecret, w.cookie); code != 403 {
		t.Fatalf("members read only: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/settings/posts/now", "", screensSecret, w.cookie); code != 403 {
		t.Fatalf("members can't post: %d", code)
	}
}
