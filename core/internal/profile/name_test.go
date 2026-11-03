package profile

import (
	"context"
	"testing"
)

// The business name is the company's name too (the sidebar, the sender of
// customer emails, Settings): saving it on the Profile renames the company
// in the same transaction, as /setup's "Company name" writes this fact.
func TestTheBusinessNameRenamesTheCompany(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	companyName := func() string {
		t.Helper()
		var name string
		if err := w.pool.QueryRow(ctx, `SELECT name FROM companies WHERE id = $1`, w.company.String()).Scan(&name); err != nil {
			t.Fatalf("name: %v", err)
		}
		return name
	}
	if outcome, err := SaveValue(ctx, w.pool, w.company, w.owner, "company_name", "", "Luigi's"); err != nil || outcome != Changed || companyName() != "Luigi's" {
		t.Fatalf("fill in: %s %v %q", outcome, err, companyName())
	}
	saveProposals(t, w, []Proposal{{Topic: "company_name", Value: "Luigi's Pizzeria"}}, SourceInterview)
	if outcome, err := Confirm(ctx, w.pool, w.company, w.owner, "company_name", "Luigi's Pizzeria", "Luigi's", "Luigi's Pizzeria"); err != nil || outcome != Changed || companyName() != "Luigi's Pizzeria" {
		t.Fatalf("confirm: %s %v %q", outcome, err, companyName())
	}
	if outcome, _ := SaveValue(ctx, w.pool, w.company, w.owner, "company_name", "Luigi's", "Mario's"); outcome != Stale || companyName() != "Luigi's Pizzeria" {
		t.Fatalf("a stale edit renames nothing: %s %q", outcome, companyName())
	}
	if outcome, _ := SaveValue(ctx, w.pool, w.company, w.owner, "industry", "", "Pizzeria"); outcome != Changed || companyName() != "Luigi's Pizzeria" {
		t.Fatalf("another topic renames nothing: %s %q", outcome, companyName())
	}
	member := w.member()
	if outcome, _ := SaveValue(ctx, w.pool, w.company, member, "company_name", "Luigi's Pizzeria", "Mine"); outcome != NotAllowed || companyName() != "Luigi's Pizzeria" {
		t.Fatalf("a member renames nothing: %s %q", outcome, companyName())
	}
}
