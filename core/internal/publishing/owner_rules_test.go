package publishing

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/drafts"
)

// ruleRow is one rule as stored: "enabled|enabled_by|has enabled_at".
func (w *world) ruleRow(t *testing.T, ruleID string) string {
	var row string
	w.pool.QueryRow(context.Background(), `SELECT enabled::text || '|' || COALESCE(enabled_by_user_id, '') || '|' || (enabled_at IS NOT NULL)::text
		FROM autopublish_rules WHERE company_id = $1 AND id = $2`, w.company.String(), ruleID).Scan(&row)
	return row
}

// The old publishing-rule-checks.ts: rules are made switched off, by
// owners only; switching one on or off is an owner's, recorded with who
// and when; one rule per platform and pillar, whatever the case.
func TestRulesAreMadeOffAndSwitchedOnlyByAnOwner(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	member := w.person(t, "member")
	if outcome, _, _ := CreateRule(ctx, w.pool, w.company, member, "facebook", ""); outcome != "not-allowed" {
		t.Fatalf("a member made a rule: %s", outcome)
	}
	outcome, ruleID, err := CreateRule(ctx, w.pool, w.company, w.owner, "facebook", "Lunch ideas")
	if outcome != "created" || err != nil || w.ruleRow(t, ruleID) != "false||false" {
		t.Fatalf("made: %s %v %s", outcome, err, w.ruleRow(t, ruleID))
	}
	if outcome, _, _ := CreateRule(ctx, w.pool, w.company, w.owner, "facebook", "lunch IDEAS"); outcome != "exists" {
		t.Fatalf("a second rule for the pillar: %s", outcome)
	}
	if outcome, _ := SetRuleEnabled(ctx, w.pool, w.company, member, ruleID, true); outcome != "not-allowed" || w.ruleRow(t, ruleID) != "false||false" {
		t.Fatalf("a member switched it on: %s", outcome)
	}
	if outcome, _ := SetRuleEnabled(ctx, w.pool, w.company, w.owner, ruleID, true); outcome != "changed" || w.ruleRow(t, ruleID) != "true|"+w.owner+"|true" {
		t.Fatalf("switched on: %s %s", outcome, w.ruleRow(t, ruleID))
	}
	if outcome, _ := SetRuleEnabled(ctx, w.pool, w.company, w.owner, ruleID, true); outcome != "unchanged" {
		t.Fatalf("on twice: %s", outcome)
	}
	if outcome, _ := SetRuleEnabled(ctx, w.pool, w.company, w.owner, ruleID, false); outcome != "changed" || w.ruleRow(t, ruleID) != "false||false" {
		t.Fatalf("switched off: %s %s", outcome, w.ruleRow(t, ruleID))
	}
	other := newWorld(t)
	if outcome, _ := SetRuleEnabled(ctx, other.pool, other.company, other.owner, ruleID, true); outcome != "not-found" {
		t.Fatalf("another company's owner found the rule: %s", outcome)
	}
	var logged []string
	rows, _ := w.pool.Query(ctx, `SELECT action || ':' || actor_user_id FROM cofounder_activity WHERE company_id = $1 AND rule_id = $2 ORDER BY created_at`, w.company.String(), ruleID)
	for rows.Next() {
		var line string
		rows.Scan(&line)
		logged = append(logged, line)
	}
	if !slices.Equal(logged, []string{"rule_created:" + w.owner, "rule_enabled:" + w.owner, "rule_disabled:" + w.owner}) {
		t.Fatalf("activity: %v", logged)
	}
	if PlanPillarNamed([]string{"Lunch ideas", "Our people"}, " our PEOPLE ") != "Our people" || PlanPillarNamed([]string{"Lunch ideas"}, "Made up") != "" {
		t.Fatal("a pillar is named as the plan spells it")
	}
}

// pillarDraft is a Facebook post of one pillar, as the AI wrote it.
func (w *world) pillarDraft(t *testing.T, pillar, body string) string {
	t.Helper()
	id, err := drafts.Create(context.Background(), w.pool, w.company, w.owner, drafts.NewDraft{Platform: "facebook", Format: "post", Topic: body, Pillar: pillar, Body: body, Generated: true})
	if err != nil {
		t.Fatalf("draft: %v", err)
	}
	return id
}

// Without an approval a draft is scheduled only with the owner's tick and
// an enabled rule covering its platform and pillar, when every claim is
// backed; a hand edit, a rejected or an archived draft never go. A rule's
// post fails when it runs once the rule is off (rule_disabled), its
// switcher is no longer an owner (rule_owner_gone) or a fact behind a claim
// changed (claims_not_checked).
func TestARuleSendsOnlyWhatItCoversWhileItsOwnersStay(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "121")
	later := time.Now().Add(time.Hour)
	lunch := w.pillarDraft(t, "Lunch ideas", "Soup today")
	_, ovenRule, _ := CreateRule(ctx, w.pool, w.company, w.owner, "facebook", "Behind the oven")
	SetRuleEnabled(ctx, w.pool, w.company, w.owner, ovenRule, true)
	if scheduled := w.tryToSchedule(t, w.owner, lunch, []string{page}, &later, true); scheduled.Outcome != "no-rule" {
		t.Fatalf("a rule for another pillar covered it: %+v", scheduled)
	}
	_, lunchRule, _ := CreateRule(ctx, w.pool, w.company, w.owner, "facebook", "Lunch ideas")
	SetRuleEnabled(ctx, w.pool, w.company, w.owner, lunchRule, true)
	if scheduled := w.tryToSchedule(t, w.owner, lunch, []string{page}, &later, false); scheduled.Outcome != "not-approved" {
		t.Fatalf("it went without the owner's tick: %+v", scheduled)
	}
	scheduled := w.tryToSchedule(t, w.owner, lunch, []string{page}, &later, true)
	if scheduled.Outcome != "scheduled" || scheduled.Mode != "auto_rule" || w.draftStatus(t, lunch) != "scheduled" {
		t.Fatalf("under the rule: %+v", scheduled)
	}
	refusals := []struct{ want, change string }{
		{"claims-need-owner", `UPDATE content_drafts SET generated_version = NULL WHERE company_id = $1 AND id = $2 AND $3 <> ''`},
		{"wrong-status", `UPDATE content_drafts SET status = 'rejected', rejected_by_user_id = $3, rejected_at = now() WHERE company_id = $1 AND id = $2`},
		{"wrong-status", `UPDATE content_drafts SET status = 'archived' WHERE company_id = $1 AND id = $2 AND $3 <> ''`},
	}
	for _, refusal := range refusals {
		draftID := w.pillarDraft(t, "Lunch ideas", "Changed: "+refusal.change)
		w.exec(t, refusal.change, w.company.String(), draftID, w.owner)
		if refused := w.tryToSchedule(t, w.owner, draftID, []string{page}, &later, true); refused.Outcome != refusal.want {
			t.Fatalf("%s: %+v", refusal.want, refused)
		}
	}
	SetRuleEnabled(ctx, w.pool, w.company, w.owner, lunchRule, false)
	w.makeDue(t, scheduled.JobIDs[0])
	if w.runNow(t, scheduled.JobIDs[0]); w.field(t, scheduled.JobIDs[0], "external_post_id") != "" || len(w.posted) != 0 {
		t.Fatal("a post of a rule switched off went out")
	}
	if _, code, _ := w.jobState(t, scheduled.JobIDs[0]); code != "rule_disabled" {
		t.Fatalf("rule off: %s", code)
	}
	switcher := w.person(t, "owner")
	SetRuleEnabled(ctx, w.pool, w.company, switcher, lunchRule, true)
	second := w.tryToSchedule(t, w.owner, w.pillarDraft(t, "Lunch ideas", "Second"), []string{page}, &later, true)
	backed := w.pillarDraft(t, "Lunch ideas", "We bake every day")
	w.exec(t, `INSERT INTO business_facts (company_id, topic, confirmed_value, confirmed_by_user_id, confirmed_at, confirmed_source) VALUES ($1, 'description', 'A bakery', $2, now(), 'owner')`, w.company.String(), w.owner)
	w.exec(t, `UPDATE content_drafts SET claims = '[{"text": "We bake", "supported": true, "fact_topics": ["description"]}]', facts_used = '[{"topic": "description", "value": "A bakery"}]'
		WHERE company_id = $1 AND id = $2`, w.company.String(), backed)
	third := w.tryToSchedule(t, w.owner, backed, []string{page}, &later, true)
	if second.Outcome != "scheduled" || third.Outcome != "scheduled" {
		t.Fatalf("under the rule again: %+v %+v", second, third)
	}
	w.exec(t, `UPDATE business_facts SET confirmed_value = 'A bakery in Porto' WHERE company_id = $1 AND topic = 'description'`, w.company.String())
	w.makeDue(t, third.JobIDs[0])
	if w.runNow(t, third.JobIDs[0]); w.field(t, third.JobIDs[0], "external_post_id") != "" {
		t.Fatal("a claim no longer backed went out")
	}
	w.exec(t, `UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), switcher)
	w.makeDue(t, second.JobIDs[0])
	w.runNow(t, second.JobIDs[0])
	_, factCode, _ := w.jobState(t, third.JobIDs[0])
	_, ownerCode, _ := w.jobState(t, second.JobIDs[0])
	if factCode != "claims_not_checked" || ownerCode != "rule_owner_gone" || len(w.posted) != 0 {
		t.Fatalf("at run time: %s %s %v", factCode, ownerCode, w.posted)
	}
	if refused := w.tryToSchedule(t, w.owner, w.pillarDraft(t, "Lunch ideas", "Fourth"), []string{page}, &later, true); refused.Outcome != "rule-owner-gone" {
		t.Fatalf("the rule scheduled while its switcher is gone: %+v", refused)
	}
}

// Nothing turns a rule on by itself: every rule core makes is saved
// switched off (and no migration turns one on), and the only write that
// sets enabled is an owner's switch (switchRuleWithin).
func TestNothingTurnsARuleOnByItself(t *testing.T) {
	literal := regexp.MustCompile("(?s)`([^`]*)`")
	insertsOff := regexp.MustCompile(`(?s)insert into autopublish_rules.*values \([^)]*\bfalse\b`)
	var switches []string
	err := filepath.Walk("..", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return err
		}
		source, err := os.ReadFile(path)
		for _, match := range literal.FindAllStringSubmatch(string(source), -1) {
			statement := strings.ToLower(match[1])
			if strings.Contains(statement, "insert into autopublish_rules") && (!insertsOff.MatchString(statement) || strings.Contains(statement, "enabled_by_user_id")) {
				t.Errorf("%s makes a rule that isn't switched off:\n%s", path, match[1])
			}
			if strings.Contains(statement, "update autopublish_rules") {
				switches = append(switches, filepath.Base(path))
			}
		}
		return err
	})
	if err != nil || !slices.Equal(switches, []string{"owner_rules.go"}) {
		t.Fatalf("writes of a rule's switch: %v %v", switches, err)
	}
	migration, err := os.ReadFile("../../../db/migrations/0037_publishing_queue.sql")
	if err != nil || !strings.Contains(string(migration), `"enabled" boolean DEFAULT false NOT NULL`) || regexp.MustCompile(`(?i)SET "enabled"|INSERT INTO "autopublish_rules"`).Match(migration) {
		t.Fatalf("the migration: %v", err)
	}
}
