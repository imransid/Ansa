package studio

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"ansa/core/internal/drafts"
)

const writtenDraft = `{"kind":"ok","draft":{"title":"Ignored off YouTube","body":"  Fresh bread\r\n\r\n\r\n\r\nevery morning.  ","hashtags":["#Bread","bread","fresh bread!"],
	"call_to_action":"Come by\ntoday","image_prompt":"A loaf","video_script":"Scene 1","claims":[
	{"text":"Baking since 1998","fact_topics":["description"]},
	{"text":"Loaves cost 3 euros","fact_topics":["prices"]},
	{"text":"  ","fact_topics":[]},
	{"text":"Loved by all","fact_topics":["made_up","description"]}]}}`

func (w *studioWorld) confirmKeyFacts() {
	w.confirm("description", "A bakery since 1998")
	w.confirm("products", "Bread and cakes")
	w.confirm("target_customers", "Neighbours")
}

func TestTheAINeedsTheKeyFactsFirstAndABlankDraftStillWorks(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	request := NewDraft{Platform: "linkedin", Format: "post", Placement: Placement{Topic: "Our bread"}}
	result, err := w.writer.Generate(ctx, w.company, w.member, request)
	if err != nil || !strings.Contains(result.Refusal, "What the business does, Products or services, Target customers") {
		t.Fatalf("the page says what is missing: %+v %v", result, err)
	}
	if len(w.asked) != 0 || w.countDrafts() != 0 {
		t.Fatal("the AI is never asked and nothing is saved")
	}
	if _, outcome, _ := Create(ctx, w.pool, w.company, w.member, request, nil); outcome != "created" {
		t.Fatal("a blank draft still works")
	}
}

func TestADraftTheAIWroteIsCleanedAndItsClaimsMarkedByCore(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	w.confirmKeyFacts()
	w.answers = []string{writtenDraft}
	result, err := w.writer.Generate(ctx, w.company, w.member, NewDraft{Platform: "x", Format: "post", Placement: Placement{Topic: "Our bread"}})
	if err != nil || result.Outcome != "created" {
		t.Fatalf("the draft is saved: %+v %v", result, err)
	}
	page, _ := ReadPage(ctx, w.pool, w.company, result.DraftID)
	f := page.Fields
	if f.Title != "" || f.ImagePrompt != "" || f.VideoScript != "" || f.Body != "Fresh bread\n\nevery morning." || f.CallToAction != "Come by today" {
		t.Fatalf("texts cleaned, and only the fields an X text post uses kept: %+v", f)
	}
	if page.GeneratedVersion == nil || *page.GeneratedVersion != 1 || page.Status != "draft" {
		t.Fatal("the AI's text is version 1 of a draft")
	}
	claims, _ := drafts.ReadStoredClaims(rawClaims(t, w, result.DraftID))
	if len(claims) != 3 || !claims[0].Supported || claims[1].Supported || claims[2].Supported || strings.Join(claims[2].FactTopics, ",") != "description" {
		t.Fatalf("core marks the claims: only facts confirmed and sent back one; blank claims and unknown topics drop: %+v", claims)
	}
	request, _ := json.Marshal(w.asked[0])
	for _, private := range []string{w.company.String(), w.member, w.owner} {
		if strings.Contains(string(request), private) {
			t.Fatal("the brain's request holds no id")
		}
	}
	platform := w.asked[0]["platform"].(map[string]any)
	if platform["text_max"].(float64) != 280 || platform["hashtags_recommended"].(float64) != 2 || platform["text_counting"] != "x" {
		t.Fatalf("the AI is told X's own rules: %v", platform)
	}
}

func rawClaims(t *testing.T, w *studioWorld, id string) []byte {
	var raw []byte
	w.pool.QueryRow(context.Background(), `SELECT claims FROM content_drafts WHERE company_id = $1 AND id = $2`, w.company.String(), id).Scan(&raw)
	return raw
}

func TestNothingIsSavedWhenTheAIFailsOrAnswersInAnotherShape(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	w.confirmKeyFacts()
	request := NewDraft{Platform: "youtube", Format: "video", Placement: Placement{Topic: "Our bread"}}
	w.answers = []string{
		`{"kind":"failed","reason":"model_failed","error_name":"RateLimitError"}`,
		`{"kind":"failed","reason":"model_unavailable"}`,
		// A YouTube video without its title: unusable.
		`{"kind":"ok","draft":{"title":"  ","body":"Text","hashtags":[],"call_to_action":"","image_prompt":"","video_script":"","claims":[]}}`,
	}
	for _, want := range []string{aiFailed, aiUnavailable, aiUnusable} {
		result, err := w.writer.Generate(ctx, w.company, w.member, request)
		if err != nil || result.Refusal != want {
			t.Fatalf("the page says why: %+v %v", result, err)
		}
	}
	if w.countDrafts() != 0 {
		t.Fatal("no draft is saved")
	}
}

func TestRegenerateNeverAsksForAnOlderPageAndNeverSavesOverAnEdit(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	w.confirmKeyFacts()
	id := w.draft("x", "post", "Bread.", nil, nil)
	if result, _ := w.writer.Regenerate(ctx, w.company, w.member, id, 2); result.Outcome != Stale || len(w.asked) != 0 {
		t.Fatalf("a page showing another version is refused before the AI is asked: %+v", result)
	}
	w.answers = []string{writtenDraft}
	if result, _ := w.writer.Regenerate(ctx, w.company, w.member, id, 1); result.Outcome != Changed {
		t.Fatalf("regenerated: %+v", result)
	}
	if status, version, _, _, _, _ := w.row(id); status != "draft" || version != 2 {
		t.Fatalf("the AI's text is the next version: %d", version)
	}
	// An edit saved while the AI was writing wins: the AI's text isn't saved.
	w.answers = []string{writtenDraft}
	w.whileWriting = func() {
		Edit(ctx, w.pool, w.company, w.member, id, 2, Placement{Topic: "Our bread"}, drafts.Fields{Body: "Edited meanwhile.", Hashtags: []string{}})
	}
	result, _ := w.writer.Regenerate(ctx, w.company, w.member, id, 2)
	w.whileWriting = nil
	if result.Refusal != staleWhileWriting {
		t.Fatalf("the AI's text is never saved over an edit made while it wrote: %+v", result)
	}
	if page, _ := ReadPage(ctx, w.pool, w.company, id); page.Fields.Body != "Edited meanwhile." || page.Version != 3 {
		t.Fatalf("the edit stays: %+v", page.Fields)
	}
	asked := len(w.asked)
	Archive(ctx, w.pool, w.company, w.member, id)
	if result, _ := w.writer.Regenerate(ctx, w.company, w.member, id, 3); result.Outcome != WrongStatus || len(w.asked) != asked {
		t.Fatalf("an archived draft is never regenerated: %+v", result)
	}
}

func TestTheHourlyLimitRefusesBeforeTheAIIsAsked(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	w.confirmKeyFacts()
	for range Generations.MaxAttempts {
		w.writer.Limiter.Over(ctx, "content-generations", w.company.String(), Generations)
	}
	result, _ := w.writer.Generate(ctx, w.company, w.owner, NewDraft{Platform: "x", Format: "post", Placement: Placement{Topic: "Bread"}})
	if result.Refusal != tooManyAIDrafts || len(w.asked) != 0 {
		t.Fatalf("over the company's hourly limit nobody is asked: %+v", result)
	}
}
