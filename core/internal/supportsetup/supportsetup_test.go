package supportsetup

import (
	"context"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// The assistant, calls, posts and alerts say the confirmed company_name
// fact first: renaming the company on /setup confirms the new name there
// too, in the owner's name, so customers never hear the old one.
func TestRenamingTheCompanyRenamesTheBusinessNameFact(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	// Setup's first step confirmed the old name, and the interview proposes the new one.
	const fact = `INSERT INTO business_facts (company_id, topic, confirmed_value, confirmed_source, confirmed_by_user_id, confirmed_at, proposed_value, proposed_source, proposed_at)
		VALUES ($1, 'company_name', 'Luigi''s', 'interview', $2, now(), 'Bella Napoli', 'interview', now())`
	if _, err := pool.Exec(ctx, fact, companyID, owner); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if outcome, err := SaveCompanyName(ctx, pool, company, owner, "Bella Napoli"); err != nil || outcome != settings.Saved {
		t.Fatalf("rename: %s %v", outcome, err)
	}
	var name, confirmed, source, confirmedBy string
	var proposed *string
	const read = `
		SELECT companies.name, facts.confirmed_value, facts.confirmed_source, facts.confirmed_by_user_id, facts.proposed_value
		FROM companies JOIN business_facts AS facts ON facts.company_id = companies.id AND facts.topic = 'company_name'
		WHERE companies.id = $1 AND facts.company_id = $1`
	if err := pool.QueryRow(ctx, read, companyID).Scan(&name, &confirmed, &source, &confirmedBy, &proposed); err != nil {
		t.Fatalf("read: %v", err)
	}
	if name != "Bella Napoli" || confirmed != "Bella Napoli" || source != "owner" || confirmedBy != owner || proposed != nil {
		t.Fatalf("one name everywhere, the owner's, the proposal saying the same cleared: %q %q %q %q %v", name, confirmed, source, confirmedBy, proposed)
	}
	member := database.TestOwner(t, pool, companyID)
	if _, err := pool.Exec(ctx, `UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, companyID, member); err != nil {
		t.Fatalf("member: %v", err)
	}
	if outcome, _ := SaveCompanyName(ctx, pool, company, member, "Mine"); outcome != settings.NotAllowed {
		t.Fatalf("a member renames nothing: %s", outcome)
	}
}
