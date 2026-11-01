package profile

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/knowledge"
	"ansa/core/internal/tenant"
)

// article writes an article of the test company and approves it unless asked not to.
func article(t *testing.T, w *world, company tenant.CompanyID, owner, title, body string, approve, support, marketing bool) string {
	t.Helper()
	ctx := context.Background()
	ids, outcome, err := knowledge.CreateDrafts(ctx, w.pool, company, owner, []knowledge.Fields{{Title: title, Body: body, Kind: "faq", UseForSupport: support, UseForMarketing: marketing}}, knowledge.Source{})
	if err != nil || outcome != "created" {
		t.Fatalf("article: %s %v", outcome, err)
	}
	if approve {
		detail, _ := knowledge.Read(ctx, w.pool, company, ids[0])
		if outcome, err := knowledge.ChangeStatus(ctx, w.pool, company, owner, ids[0], "approve", detail.Revision); err != nil || outcome == "not-allowed" {
			t.Fatalf("approve: %s %v", outcome, err)
		}
	}
	return ids[0]
}

func TestSuggestionsReadAnApprovedArticleAndProposeOnly(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	SaveValue(ctx, w.pool, w.company, w.owner, "industry", "", "Bakery")
	id := article(t, w, w.company, w.owner, "About <us>", "We bake bread every night.", true, true, false)
	w.reply(`{"kind":"ok","proposed_facts":[{"topic":"industry","value":"Bakery and café"},{"topic":"description","value":"We bake bread."}]}`)
	result, err := w.service.Suggest(ctx, w.company, w.owner, id)
	if err != nil || result.Outcome != Saved || len(result.ProposedTopics) != 2 || !result.ReadWholeArticle {
		t.Fatalf("result: %+v %v", result, err)
	}
	if facts := w.facts(); facts["industry"] != (Values{Confirmed: "Bakery", Proposed: "Bakery and café"}) || facts["description"].Proposed != "We bake bread." {
		t.Fatalf("proposals only, beside the fact: %v", facts)
	}
	page, _ := ReadPage(ctx, w.pool, w.company)
	if page.Groups[0].Topics[1].Proposal.Source != SourceKnowledge {
		t.Fatal("the proposal names knowledge as its source")
	}
	sent := w.lastAsked()["article"].(string)
	if sent != "<article title=\"About &lt;us&gt;\">\nWe bake bread every night.\n</article>" {
		t.Fatalf("the article as the brain got it: %q", sent)
	}
}

func TestSuggestionsRefuseWhatNoAIMayReadWithoutAskingTheBrain(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	pool := database.ForTest(t)
	other, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	otherOwner := database.TestOwner(t, pool, other.String())
	refused := map[string]string{
		"a draft":                     article(t, w, w.company, w.owner, "Draft", "Text.", false, true, true),
		"ticked for neither":          article(t, w, w.company, w.owner, "Neither", "Text.", true, false, false),
		"another company's":           article(t, w, other, otherOwner, "Theirs", "Text.", true, true, true),
		"not an article at all (bad)": "00000000-0000-4000-8000-000000000000",
	}
	for name, id := range refused {
		result, err := w.service.Suggest(ctx, w.company, w.owner, id)
		if err != nil || (result.Outcome != ArticleNotFound && result.Outcome != ArticleNotForAI) {
			t.Fatalf("%s: %+v %v", name, result, err)
		}
	}
	if w.timesAsked() != 0 {
		t.Fatal("the brain was asked about an article no AI may read")
	}
	choices, _ := ArticlesForSuggestions(ctx, w.pool, w.company)
	if len(choices) != 0 {
		t.Fatalf("the menu lists only approved articles for support or marketing: %v", choices)
	}
}

func TestAFailedAnswerProposesNothingAndALongArticleIsReadInItsFirstPieces(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	paragraph := strings.Repeat("Our bread is baked slowly overnight. ", 38)
	long := strings.TrimSpace(strings.Repeat(paragraph+"\n\n", 12))
	id := article(t, w, w.company, w.owner, "Long", long, true, false, true)
	if result, _ := w.service.Suggest(ctx, w.company, w.owner, id); result.Outcome != NoAnswer || len(w.facts()) != 0 {
		t.Fatalf("a failed answer: %+v", result)
	}
	w.reply(`{"kind":"ok","proposed_facts":[]}`)
	result, _ := w.service.Suggest(ctx, w.company, w.owner, id)
	if result.Outcome != Saved || result.ReadWholeArticle || len(result.ProposedTopics) != 0 {
		t.Fatalf("a long article: %+v", result)
	}
	if sent := w.lastAsked()["article"].(string); UTF16Length(sent) > articleCharactersForSuggestions || strings.Count(sent, "<article ") < 2 {
		t.Fatalf("the slice: %d characters", UTF16Length(sent))
	}
	if outcome, _ := SaveValue(ctx, w.pool, w.company, w.member(), "industry", "", "x"); outcome != NotAllowed {
		t.Fatal("members can't change the profile")
	}
}
