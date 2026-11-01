package strategy

import (
	"encoding/json"
	"strings"
	"testing"

	"ansa/core/internal/knowledge"
)

// goodPlan is a usable plan as the brain returns it; change makes one field different.
func goodPlan(change func(map[string]any)) []byte {
	plan := map[string]any{
		"summary":     "A plan.",
		"audiences":   []any{map[string]any{"name": "Locals", "needs": "Bread", "where_to_reach": "Facebook"}},
		"positioning": "The neighbourhood bakery.",
		"goals":       []any{map[string]any{"goal": "More regulars", "how_to_measure": "Repeat visits"}},
		"pillars": []any{
			map[string]any{"name": "Bread", "description": "How we bake.", "example_topics": []any{"Sourdough"}},
			map[string]any{"name": "People", "description": "Who we are.", "example_topics": []any{"Our baker"}},
			map[string]any{"name": "Town", "description": "Where we are.", "example_topics": []any{"Market day"}},
		},
		"campaigns":           []any{map[string]any{"name": "Autumn", "objective": "Visits", "pillar": "Bread", "platforms": []any{"facebook", "facebook"}, "timing": "October", "call_to_action": "Come by"}},
		"cadence":             []any{map[string]any{"platform": "facebook", "posts_per_week": 2.25, "formats": []any{"photo"}}},
		"statements":          []any{map[string]any{"text": "We bake daily.", "basis": "fact", "fact_topics": []any{"description"}}},
		"missing_information": []any{},
		"cautions":            []any{},
	}
	if change != nil {
		change(plan)
	}
	raw, _ := json.Marshal(plan)
	return raw
}

func TestAPlanIsCutToSizeNeverRefusedForItsLength(t *testing.T) {
	long := strings.Repeat("word ", 400)
	plan, ok := ReadPlan(goodPlan(func(p map[string]any) {
		p["summary"] = "Line one\nline two " + long
		p["missing_information"] = []any{"  ", "First", "Second", "", "3", "4", "5", "6", "7", "8", "9", "10", "11"}
		p["cadence"] = []any{
			map[string]any{"platform": "x", "posts_per_week": 0.04, "formats": []any{}},
			map[string]any{"platform": "facebook", "posts_per_week": 2.25, "formats": []any{"photo"}},
			map[string]any{"platform": "facebook", "posts_per_week": 5, "formats": []any{}},
		}
	}), map[string]bool{"description": true})
	if !ok {
		t.Fatal("a long plan is cut, never refused")
	}
	if !strings.HasPrefix(plan.Summary, "Line one line two word") || !strings.HasSuffix(plan.Summary, "word...") || len(plan.Summary) > 1_500 {
		t.Fatalf("summary: %d %q", len(plan.Summary), plan.Summary[len(plan.Summary)-20:])
	}
	if len(plan.MissingInformation) != 10 || plan.MissingInformation[0] != "First" {
		t.Fatalf("blank entries drop, the first 10 stay: %v", plan.MissingInformation)
	}
	if len(plan.Cadence) != 1 || plan.Cadence[0].PostsPerWeek != 2.3 || plan.Campaigns[0].Platforms[0] != "facebook" || len(plan.Campaigns[0].Platforms) != 1 {
		t.Fatalf("zero and repeated entries drop, one decimal: %+v %v", plan.Cadence, plan.Campaigns[0].Platforms)
	}
	if CutPlanText("好好好好好好好好好好", 8) != "好好好好好..." || CutPlanText("one two three four", 12) != "one two..." {
		t.Fatalf("cuts: %q %q", CutPlanText("好好好好好好好好好好", 8), CutPlanText("one two three four", 12))
	}
}

func TestAPlanOfAnotherShapeIsUnusable(t *testing.T) {
	broken := map[string]func(map[string]any){
		"a company field":     func(p map[string]any) { p["companyId"] = "x" },
		"a missing summary":   func(p map[string]any) { delete(p, "summary") },
		"a blank positioning": func(p map[string]any) { p["positioning"] = "  \n " },
		"two pillars":         func(p map[string]any) { p["pillars"] = p["pillars"].([]any)[:2] },
		"an unknown platform": func(p map[string]any) {
			p["cadence"] = []any{map[string]any{"platform": "tiktok", "posts_per_week": 1, "formats": []any{}}}
		},
		"a cadence over 14": func(p map[string]any) {
			p["cadence"] = []any{map[string]any{"platform": "x", "posts_per_week": 15, "formats": []any{}}}
		},
		"only zero cadences": func(p map[string]any) {
			p["cadence"] = []any{map[string]any{"platform": "x", "posts_per_week": 0, "formats": []any{}}}
		},
		"an unknown basis": func(p map[string]any) {
			p["statements"] = []any{map[string]any{"text": "x", "basis": "guess", "fact_topics": []any{}}}
		},
		"a person in an entry": func(p map[string]any) {
			p["goals"] = []any{map[string]any{"goal": "x", "how_to_measure": "y", "createdBy": "me"}}
		},
		"no statement": func(p map[string]any) { p["statements"] = []any{} },
	}
	for name, change := range broken {
		if _, ok := ReadPlan(goodPlan(change), nil); ok {
			t.Fatalf("%s: read as usable", name)
		}
	}
	if _, ok := ReadPlan([]byte(`{"summary": 1}`), nil); ok {
		t.Fatal("another type")
	}
}

func TestAFactNamingNoSentFactIsAnAssumption(t *testing.T) {
	plan, _ := ReadPlan(goodPlan(func(p map[string]any) {
		p["statements"] = []any{
			map[string]any{"text": "Only sent facts.", "basis": "fact", "fact_topics": []any{"description", "description"}},
			map[string]any{"text": "A proposal.", "basis": "fact", "fact_topics": []any{"description", "prices"}},
			map[string]any{"text": "Nothing named.", "basis": "fact", "fact_topics": []any{}},
			map[string]any{"text": "A suggestion.", "basis": "suggestion", "fact_topics": []any{"prices", "nope"}},
		}
	}), map[string]bool{"description": true})
	bases := []string{}
	for _, statement := range plan.Statements {
		bases = append(bases, statement.Basis+":"+strings.Join(statement.FactTopics, ","))
	}
	if strings.Join(bases, " ") != "fact:description assumption:description assumption: suggestion:" {
		t.Fatalf("the fact rule: %v", bases)
	}
}

func TestReadinessAndTheSearchTakingTurns(t *testing.T) {
	missing := MissingForPlan(map[string]bool{"services": true})
	if len(missing) != 2 || missing[0].Label != "What the business does" || missing[1].Label != "Target customers" {
		t.Fatalf("products or services is enough: %v", missing)
	}
	if len(MissingForPlan(map[string]bool{"description": true, "products": true, "target_customers": true})) != 0 {
		t.Fatal("ready")
	}
	products := "sourdough rye baguette croissant brioche focaccia ciabatta bagel pretzel muffin scone danish strudel eclair tart pie cake cookie biscuit loaf extra"
	combined := knowledge.CombineSearchTexts([]string{products, "catering weddings", "more regulars"})
	words := strings.Fields(combined)
	if len(words) != 20 || words[0] != "sourdough" || words[1] != "catering" || words[2] != "more" || !strings.Contains(combined, "weddings") || !strings.Contains(combined, "regulars") {
		t.Fatalf("each text takes its turn: %q", combined)
	}
}
