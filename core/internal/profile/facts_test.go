package profile

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func TestTopicsAndCompletionCountConfirmedKeyFactsOnly(t *testing.T) {
	if len(Topics) != 25 || len(KeyTopics()) != 16 || KeyTopics()[0].Key != "company_name" {
		t.Fatalf("the topic list changed: %d topics, %d key", len(Topics), len(KeyTopics()))
	}
	facts := Facts{"company_name": {Confirmed: "Luigi's"}, "description": {Proposed: "Pizza"}, "website": {Confirmed: "luigi.example"}}
	if c := facts.Completion(); c.KeyConfirmed != 1 || c.KeyTotal != 16 || c.ProposalsWaiting != 1 {
		t.Fatalf("a proposal or a non-key fact counted: %+v", c)
	}
	if missing, _ := facts.FirstMissingKeyTopic(); missing.Key != "industry" {
		t.Fatalf("a proposal counts as answered for the interview: %s", missing.Key)
	}
	if LabelOf("gone_topic") != "gone_topic" || LabelOf("goals") != "Marketing goals" {
		t.Fatal("labels")
	}
}

func TestAProposalNeverOverwritesAConfirmedValueAndConfirmRecordsItsSource(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	if outcome, _ := SaveValue(ctx, w.pool, w.company, w.owner, "industry", "", "Bakery"); outcome != Changed {
		t.Fatalf("fill in: %s", outcome)
	}
	saveProposals(t, w, []Proposal{{Topic: "industry", Value: "Bakery and café"}, {Topic: "description", Value: "We bake."}}, SourceInterview)
	if facts := w.facts(); facts["industry"] != (Values{Confirmed: "Bakery", Proposed: "Bakery and café"}) {
		t.Fatalf("the proposal went over the fact: %+v", facts["industry"])
	}
	if topics := saveProposals(t, w, []Proposal{{Topic: "industry", Value: "Bakery"}, {Topic: "description", Value: "We bake."}}, SourceInterview); len(topics) != 0 {
		t.Fatalf("a proposal equal to the fact or the waiting one wrote: %v", topics)
	}
	if outcome, _ := Confirm(ctx, w.pool, w.company, w.owner, "description", "We bake.", "", "We bake."); outcome != Changed {
		t.Fatalf("confirm: %s", outcome)
	}
	if outcome, _ := Confirm(ctx, w.pool, w.company, w.owner, "industry", "Bakery and café", "Bakery", "A bakery"); outcome != Changed {
		t.Fatalf("edit and confirm: %s", outcome)
	}
	page, _ := ReadPage(ctx, w.pool, w.company)
	sources := map[string]string{}
	for _, group := range page.Groups {
		for _, topic := range group.Topics {
			if topic.Confirmed != nil {
				sources[topic.Topic] = topic.Confirmed.Source + ":" + topic.Confirmed.Value + ":" + *topic.Confirmed.ByName
			}
			if topic.Proposal != nil {
				t.Fatalf("a confirmed proposal is still waiting: %s", topic.Topic)
			}
		}
	}
	if sources["description"] != "interview:We bake.:Core Test Owner" || sources["industry"] != "owner:A bakery:Core Test Owner" {
		t.Fatalf("sources: %v", sources)
	}
	if page.Completion.KeyConfirmed != 2 || len(page.MissingKeyTopics) != 14 || len(page.Groups) != 6 {
		t.Fatalf("page: %+v", page.Completion)
	}
}

func TestChangesMeanwhileAreStaleAndChangeNothing(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	SaveValue(ctx, w.pool, w.company, w.owner, "goals", "", "More bookings")
	saveProposals(t, w, []Proposal{{Topic: "goals", Value: "More regulars"}}, SourceKnowledge)
	checks := map[string]func() (string, error){
		"a proposal not the one shown": func() (string, error) {
			return Confirm(ctx, w.pool, w.company, w.owner, "goals", "Older proposal", "More bookings", "Older proposal")
		},
		"a fact changed after the page showed it": func() (string, error) {
			return Confirm(ctx, w.pool, w.company, w.owner, "goals", "More regulars", "Something else", "More regulars")
		},
		"a dismissal of another proposal": func() (string, error) { return Dismiss(ctx, w.pool, w.company, w.owner, "goals", "Older proposal") },
		"an edit of a changed fact":       func() (string, error) { return SaveValue(ctx, w.pool, w.company, w.owner, "goals", "", "Mine") },
	}
	for name, change := range checks {
		if outcome, err := change(); err != nil || outcome != Stale {
			t.Fatalf("%s: %s %v", name, outcome, err)
		}
	}
	if facts := w.facts(); facts["goals"] != (Values{Confirmed: "More bookings", Proposed: "More regulars"}) {
		t.Fatalf("a stale change wrote: %+v", facts["goals"])
	}
	if outcome, _ := SaveValue(ctx, w.pool, w.company, w.owner, "goals", "More bookings", "More bookings"); outcome != Unchanged {
		t.Fatalf("the same value again: %s", outcome)
	}
	if outcome, _ := SaveValue(ctx, w.pool, w.company, w.owner, "goals", "More bookings", "More regulars"); outcome != Changed || w.facts()["goals"].Proposed != "" {
		t.Fatal("typing what waits clears the proposal")
	}
	if outcome, _ := Dismiss(ctx, w.pool, w.company, w.owner, "goals", "More regulars"); outcome != Stale {
		t.Fatalf("nothing waits any more: %s", outcome)
	}
}

func TestMembersAndOtherCompaniesChangeNothing(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	member := w.member()
	saveProposals(t, w, []Proposal{{Topic: "industry", Value: "Bakery"}}, SourceInterview)
	if outcome, _ := Confirm(ctx, w.pool, w.company, member, "industry", "Bakery", "", "Bakery"); outcome != NotAllowed {
		t.Fatalf("a member confirmed: %s", outcome)
	}
	if outcome, _ := SaveValue(ctx, w.pool, w.company, member, "languages", "", "English"); outcome != NotAllowed {
		t.Fatalf("a member typed a fact: %s", outcome)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), w.owner)
	if outcome, _ := Dismiss(ctx, w.pool, w.company, w.owner, "industry", "Bakery"); outcome != NotAllowed {
		t.Fatalf("an owner made a member dismissed: %s", outcome)
	}
	pool := database.ForTest(t)
	other, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	otherOwner := database.TestOwner(t, pool, other.String())
	if outcome, _ := Confirm(ctx, w.pool, other, otherOwner, "industry", "Bakery", "", "Bakery"); outcome != Stale {
		t.Fatalf("another company confirmed: %s", outcome)
	}
	if facts, _ := ReadFacts(ctx, w.pool, other); len(facts) != 0 {
		t.Fatalf("another company read the facts: %v", facts)
	}
	if facts := w.facts(); facts["industry"] != (Values{Proposed: "Bakery"}) || len(facts) != 1 {
		t.Fatalf("something changed: %v", facts)
	}
}

func TestCleaningAndCuttingCountAsTheOldCodeDid(t *testing.T) {
	cleaned := CleanFactValue("  We bake.\r\n\r\n\r\n\r\nBread\x00 too.\t ")
	if cleaned != "We bake.\n\nBread too." {
		t.Fatalf("cleaned: %q", cleaned)
	}
	if CutToLength("ab😊c", 3) != "ab" || UTF16Length("😊") != 2 || len([]rune(CleanFactValue(strings.Repeat("é", 2_100)))) != 2_000 {
		t.Fatal("cuts count UTF-16 units and never split a character")
	}
	kept := CheckProposals([]Proposal{{Topic: "nope", Value: "x"}, {Topic: "prices", Value: " "}, {Topic: "goals", Value: "A"}, {Topic: "goals", Value: "B"}})
	if len(kept) != 1 || kept[0] != (Proposal{Topic: "goals", Value: "B"}) {
		t.Fatalf("proposals core keeps: %v", kept)
	}
	if _, problem := FormText(" \r\n ", FactMaxLength, "empty", "long"); problem != "empty" {
		t.Fatal("a blank fact")
	}
	if text, problem := FormText("a\r\nb", 3, "empty", "long"); problem != "" || text != "a\nb" {
		t.Fatalf("a line break counts once: %q %q", text, problem)
	}
	if _, problem := FormText("a\x07", 10, "empty", "long"); problem == "" {
		t.Fatal("a control character")
	}
}

func saveProposals(t *testing.T, w *world, proposals []Proposal, source string) []string {
	t.Helper()
	var topics []string
	err := database.InTx(context.Background(), w.pool, func(tx database.Tx) error {
		var err error
		topics, err = SaveProposalsWithin(context.Background(), tx, w.company, proposals, source)
		return err
	})
	if err != nil {
		t.Fatalf("saving proposals: %v", err)
	}
	return topics
}
