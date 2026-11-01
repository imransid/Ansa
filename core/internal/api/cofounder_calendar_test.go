package api

import (
	"strings"
	"testing"
)

func TestTheCalendarAndTheOverviewThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	withCofounderBrain(t, w)
	code, answer := w.call("GET", "/api/v1/cofounder/overview", "", screensSecret, w.cookie)
	if code != 200 || len(answer["checklist"].([]any)) != 7 || len(answer["nextSteps"].([]any)) != 1 || answer["strategy"].(map[string]any)["currentPlan"] != nil {
		t.Fatalf("the overview: %d %v", code, answer)
	}
	code, answer = w.call("GET", "/api/v1/cofounder/calendar", "", screensSecret, w.cookie)
	if code != 200 || len(answer["items"].([]any)) != 0 || answer["canPlan"] != true || answer["planVersion"] != nil {
		t.Fatalf("the calendar: %d %v", code, answer)
	}
	for _, zone := range []string{`{}`, `{"timeZone":"Mars/Olympus"}`, `{"timeZone":"../etc"}`} {
		if code, _ := w.call("POST", "/api/v1/cofounder/calendar/plan", zone, screensSecret, w.cookie); code != 400 {
			t.Fatalf("%s: %d", zone, code)
		}
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/calendar/plan", `{"timeZone":"Europe/Rome"}`, screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "no marketing plan yet") {
		t.Fatalf("without a plan: %d %v", code, answer)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/cofounder/calendar/plan", `{"timeZone":"Europe/Rome"}`, screensSecret, w.cookie); code != 403 {
		t.Fatalf("members don't plan: %d", code)
	}
	if code, answer := w.call("GET", "/api/v1/cofounder/overview", "", screensSecret, w.cookie); code != 200 || len(answer["nextSteps"].([]any)) != 0 {
		t.Fatalf("members read the overview without next steps: %d %v", code, answer)
	}
}
