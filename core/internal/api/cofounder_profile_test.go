package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
)

// withCofounderBrain gives the API a fake brain answering in turn (never
// the real model), and removes the counters the test's calls made.
func withCofounderBrain(t *testing.T, w *apiWorld, answers ...string) {
	t.Helper()
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		answer := `{"kind":"failed","reason":"model_unavailable"}`
		if len(answers) > 0 {
			answer, answers = answers[0], answers[1:]
		}
		io.WriteString(rw, answer)
	}))
	t.Cleanup(brain.Close)
	w.serverAPI().CofounderBrain = brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second)
	limiter := w.serverAPI().Limiter
	t.Cleanup(func() {
		for _, key := range []string{
			limiter.Key("business-profile-changes", w.ownerID()), limiter.Key("onboarding-turns", w.company.String()),
			limiter.Key("fact-suggestions", w.company.String()), limiter.Key("marketing-plans", w.company.String()),
			limiter.Key("calendar-plans", w.company.String()), limiter.Key("settings-changes", w.ownerID()),
		} {
			w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, key)
		}
	})
}

func TestTheBusinessProfileThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	withCofounderBrain(t, w)
	code, answer := w.call("GET", "/api/v1/cofounder/profile", "", screensSecret, w.cookie)
	if code != 200 || answer["canManage"] != true || len(answer["profile"].(map[string]any)["groups"].([]any)) != 6 {
		t.Fatalf("the page: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/profile/edit", `{"topic":"industry","value":"Bakery\r\nand café","originalValue":""}`, screensSecret, w.cookie); code != 200 || answer["outcome"] != "changed" {
		t.Fatalf("fill in: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/cofounder/profile/edit", `{"topic":"industry","value":"Other","originalValue":""}`, screensSecret, w.cookie); code != 409 {
		t.Fatalf("an edit of a fact changed meanwhile: %d", code)
	}
	long := `{"topic":"industry","value":"` + strings.Repeat("x", 2_001) + `","originalValue":"Bakery\nand café"}`
	if code, answer := w.call("POST", "/api/v1/cofounder/profile/edit", long, screensSecret, w.cookie); code != 400 || answer["fields"] == nil {
		t.Fatalf("a fact over 2,000 characters: %d %v", code, answer)
	}
	for _, refused := range []string{
		`{"topic":"nope","shownProposal":"x","shownConfirmedValue":""}`,
		`{"topic":"industry","shownProposal":"x","shownConfirmedValue":"","companyId":"x"}`,
	} {
		if code, _ := w.call("POST", "/api/v1/cofounder/profile/confirm", refused, screensSecret, w.cookie); code != 400 {
			t.Fatalf("refused: %s %d", refused, code)
		}
	}
	if code, _ := w.call("POST", "/api/v1/cofounder/profile/dismiss", `{"topic":"industry","shownProposal":"Nothing waits"}`, screensSecret, w.cookie); code != 409 {
		t.Fatalf("a dismissal of a proposal that isn't there: %d", code)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/cofounder/profile/edit", `{"topic":"goals","value":"More","originalValue":""}`, screensSecret, w.cookie); code != 403 {
		t.Fatalf("members read only: %d", code)
	}
	if code, answer := w.call("GET", "/api/v1/cofounder/profile", "", screensSecret, w.cookie); code != 200 || answer["canManage"] != false {
		t.Fatalf("members read it: %d %v", code, answer)
	}
}

func TestTheInterviewThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	withCofounderBrain(t, w, `{"kind":"ok","proposed_facts":[{"topic":"company_name","value":"Luigi's"}],"next_question":"What do you sell?","interview_complete":false}`)
	code, answer := w.call("GET", "/api/v1/cofounder/interview", "", screensSecret, w.cookie)
	opening := answer["interview"].(map[string]any)["opening"].(map[string]any)
	if code != 200 || opening["topic"] != "company_name" || answer["canAnswer"] != true {
		t.Fatalf("the opening: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/interview/answer", `{"answer":"   "}`, screensSecret, w.cookie); code != 400 || answer["fields"] == nil {
		t.Fatalf("a blank answer: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/cofounder/interview/answer", `{"answer":"Hi","openingTopic":"nope"}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("an odd opening topic: %d", code)
	}
	code, answer = w.call("POST", "/api/v1/cofounder/interview/answer", `{"answer":"We are Luigi's.","openingTopic":"company_name"}`, screensSecret, w.cookie)
	if code != 200 || answer["aiReadAnswer"] != true || len(answer["proposedTopics"].([]any)) != 1 {
		t.Fatalf("the answer: %d %v", code, answer)
	}
	if w.count(`SELECT count(*) FROM onboarding_messages WHERE company_id = $1`) != 3 {
		t.Fatal("the opening, the answer and the reply are saved")
	}
	code, answer = w.call("POST", "/api/v1/cofounder/interview/answer", `{"answer":"Pizza."}`, screensSecret, w.cookie)
	if code != 200 || answer["aiReadAnswer"] != false || answer["fixedQuestionTopic"].(map[string]any)["topic"] != "description" {
		t.Fatalf("without the AI: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/cofounder/interview/start-over", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("start over: %d", code)
	}
	if w.count(`SELECT count(*) FROM onboarding_messages WHERE company_id = $1`) != 0 || w.count(`SELECT count(*) FROM business_facts WHERE company_id = $1`) != 1 {
		t.Fatal("Start over deletes the messages, never the facts")
	}
	if code, _ := w.call("POST", "/api/v1/cofounder/profile/suggest", `{"articleId":"00000000-0000-4000-8000-000000000000"}`, screensSecret, w.cookie); code != 404 {
		t.Fatalf("an article that isn't the company's: %d", code)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/cofounder/interview/answer", `{"answer":"Hi"}`, screensSecret, w.cookie); code != 403 {
		t.Fatalf("members don't answer: %d", code)
	}
}
