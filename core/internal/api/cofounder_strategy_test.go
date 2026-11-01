package api

import (
	"strings"
	"testing"
)

// A usable plan as the brain returns it.
const brainPlan = `{"kind":"ok","plan":{"summary":"A plan.","audiences":[{"name":"Locals","needs":"Bread","where_to_reach":"Facebook"}],
	"positioning":"The bakery.","goals":[{"goal":"Regulars","how_to_measure":"Visits"}],
	"pillars":[{"name":"Bread","description":"Baking.","example_topics":["Rye"]},{"name":"People","description":"Us.","example_topics":["Baker"]},{"name":"Town","description":"Here.","example_topics":["Market"]}],
	"campaigns":[{"name":"Autumn","objective":"Visits","pillar":"Bread","platforms":["facebook"],"timing":"October","call_to_action":"Come"}],
	"cadence":[{"platform":"facebook","posts_per_week":3,"formats":["photo"]}],
	"statements":[{"text":"We bake.","basis":"fact","fact_topics":["description","prices"]}],"missing_information":[],"cautions":[]}}`

func TestTheStrategyThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	withCofounderBrain(t, w, brainPlan)
	code, answer := w.call("GET", "/api/v1/cofounder/strategy", "", screensSecret, w.cookie)
	strategy := answer["strategy"].(map[string]any)
	if code != 200 || strategy["current"] != nil || len(strategy["missingForPlan"].([]any)) != 3 || strategy["usesSupportTrends"] != false {
		t.Fatalf("no plan yet: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/strategy/plan", `{"goalNote":""}`, screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "What the business does, Products or services, Target customers") {
		t.Fatalf("not ready: %d %v", code, answer)
	}
	for _, fact := range []string{"description", "products", "target_customers"} {
		w.call("POST", "/api/v1/cofounder/profile/edit", `{"topic":"`+fact+`","value":"Known","originalValue":""}`, screensSecret, w.cookie)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/strategy/plan", `{"goalNote":"`+strings.Repeat("n", 1_001)+`"}`, screensSecret, w.cookie); code != 400 || answer["fields"] == nil {
		t.Fatalf("a note over 1,000 characters: %d", code)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/strategy/plan", `{"goalNote":"  Weekends\r\n "}`, screensSecret, w.cookie); code != 200 || answer["version"] != float64(1) {
		t.Fatalf("made: %d %v", code, answer)
	}
	code, answer = w.call("GET", "/api/v1/cofounder/strategy/versions/1", "", screensSecret, w.cookie)
	plan := answer["plan"].(map[string]any)
	statement := plan["content"].(map[string]any)["statements"].([]any)[0].(map[string]any)
	if code != 200 || plan["goalNote"] != "Weekends" || statement["basis"] != "assumption" || answer["newestVersion"] != float64(1) {
		t.Fatalf("a 'fact' naming a topic that wasn't sent is an assumption: %d %v", code, answer)
	}
	for _, path := range []string{"/api/v1/cofounder/strategy/versions/2", "/api/v1/cofounder/strategy/versions/abc", "/api/v1/cofounder/strategy/versions/0"} {
		if code, _ := w.call("GET", path, "", screensSecret, w.cookie); code != 404 {
			t.Fatalf("%s: %d", path, code)
		}
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/strategy/plan", `{"goalNote":""}`, screensSecret, w.cookie); code != 502 || !strings.Contains(answer["error"].(string), "isn't available") {
		t.Fatalf("without the AI nothing is saved: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/strategy/support-trends", `{"useSupportTrends":true}`, screensSecret, w.cookie); code != 200 || answer["outcome"] != "changed" {
		t.Fatalf("the setting: %d %v", code, answer)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/cofounder/strategy/plan", `{"goalNote":""}`, screensSecret, w.cookie); code != 403 {
		t.Fatalf("members don't make plans: %d", code)
	}
	if code, answer := w.call("GET", "/api/v1/cofounder/strategy", "", screensSecret, w.cookie); code != 200 || answer["canManage"] != false || answer["strategy"].(map[string]any)["usesSupportTrends"] != true {
		t.Fatalf("members read it: %d %v", code, answer)
	}
}
