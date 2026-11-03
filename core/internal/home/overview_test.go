package home

import (
	"context"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Setup writes the business's name, what it does and its address as
// confirmed facts: that alone never starts the marketing helper, so Home
// shows no post numbers. A fact of another topic, a draft or an interview
// message does.
func TestTheSetupsFactsDontStartTheMarketingHelper(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	newCompany := func() (tenant.CompanyID, string) {
		companyID := database.TestCompany(t, pool)
		company, _ := tenant.FromTrustedSource(companyID)
		owner := database.TestOwner(t, pool, companyID)
		for _, topic := range []string{"company_name", "description", "location"} {
			confirmFact(t, pool, company, owner, topic)
		}
		return company, owner
	}
	marketing := func(company tenant.CompanyID, owner string) *MarketingNumbers {
		t.Helper()
		overview, err := ReadOverview(ctx, pool, company, "owner", owner)
		if err != nil {
			t.Fatalf("overview: %v", err)
		}
		return overview.Marketing
	}

	company, owner := newCompany()
	if numbers := marketing(company, owner); numbers != nil {
		t.Fatalf("setup alone started nothing: %+v", numbers)
	}
	confirmFact(t, pool, company, owner, "industry")
	if numbers := marketing(company, owner); numbers == nil || numbers.KeyFactsConfirmed != 4 {
		t.Fatalf("a fact of its own starts it, the setup's facts counted too: %+v", numbers)
	}

	company, owner = newCompany()
	const idea = `INSERT INTO content_drafts (company_id, platform, format, topic, status, created_by_user_id, updated_by_user_id) VALUES ($1, 'facebook', 'post', 'Lunch', 'idea', $2, $2)`
	if _, err := pool.Exec(ctx, idea, company.String(), owner); err != nil {
		t.Fatalf("draft: %v", err)
	}
	if marketing(company, owner) == nil {
		t.Fatal("a draft starts it")
	}

	company, owner = newCompany()
	const message = `INSERT INTO onboarding_messages (id, company_id, author, body_encrypted) VALUES (gen_random_uuid(), $1, 'assistant', 'v1:x:y:z')`
	if _, err := pool.Exec(ctx, message, company.String()); err != nil {
		t.Fatalf("interview message: %v", err)
	}
	if marketing(company, owner) == nil {
		t.Fatal("an interview message starts it")
	}
}

// confirmFact saves one confirmed fact of the owner's, as setup does.
func confirmFact(t *testing.T, pool *database.Pool, company tenant.CompanyID, owner, topic string) {
	t.Helper()
	const insert = `INSERT INTO business_facts (company_id, topic, confirmed_value, confirmed_source, confirmed_by_user_id, confirmed_at) VALUES ($1, $2, 'x', 'owner', $3, now())`
	if _, err := pool.Exec(context.Background(), insert, company.String(), topic, owner); err != nil {
		t.Fatalf("fact: %v", err)
	}
}
