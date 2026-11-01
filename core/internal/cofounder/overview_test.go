package cofounder

import (
	"context"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/profile"
	"ansa/core/internal/tenant"
)

func steps(t *testing.T, pool *database.Pool, company tenant.CompanyID) map[string]Step {
	t.Helper()
	overview, err := Read(context.Background(), pool, company, true)
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	byKey := map[string]Step{}
	for _, step := range overview.Checklist {
		byKey[step.Key] = step
	}
	return byKey
}

func TestTheChecklistFollowsTheCompanysRealStateStepByStep(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	exec := func(statement string, args ...any) {
		if _, err := pool.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("setup: %v", err)
		}
	}
	first := steps(t, pool, company)
	if len(first) != 7 || first["interview"].Status != "Not started yet" || first["key_facts"].Status != "0 of 16 confirmed" || first["account"].Status != "None connected yet" {
		t.Fatalf("a new company: %+v", first)
	}
	overview, _ := Read(ctx, pool, company, true)
	if len(overview.NextSteps) != 1 || overview.NextSteps[0].Label != "Start the interview" || overview.NextSteps[0].Description != "Still missing: Business name, What the business does, Industry and 13 more. You can also fill them in yourself on the Profile page." {
		t.Fatalf("next steps: %+v", overview.NextSteps)
	}
	if members, _ := Read(ctx, pool, company, false); len(members.NextSteps) != 0 {
		t.Fatal("members get no next steps")
	}
	for _, topic := range profile.KeyTopics() {
		profile.SaveValue(ctx, pool, company, owner, topic.Key, "", "Known")
	}
	exec(`INSERT INTO onboarding_messages (id, company_id, author, author_user_id, body_encrypted, ends_interview) VALUES (gen_random_uuid(), $1, 'assistant', NULL, 'v1:x:y:z', true)`, companyID)
	exec(`INSERT INTO content_drafts (company_id, platform, format, topic, status, created_by_user_id, updated_by_user_id) VALUES ($1, 'facebook', 'post', 'An idea', 'idea', $2, $2)`, companyID, owner)
	middle := steps(t, pool, company)
	if !middle["interview"].Done || middle["interview"].Status != "Covered every key fact" || !middle["key_facts"].Done || middle["first_draft"].Done {
		t.Fatalf("an idea holds nothing written: %+v", middle)
	}
	exec(`INSERT INTO content_drafts (company_id, platform, format, topic, body, status, created_by_user_id, updated_by_user_id) VALUES ($1, 'facebook', 'post', 'Written', 'Text', 'draft', $2, $2)`, companyID, owner)
	exec(`INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id, is_stand_in)
		VALUES ($1, 'facebook', 'dev:stand-in', 'Stand-in', 'page', 'placeholder', $2, true)`, companyID, owner)
	exec(`INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, access_expires_at, connected_by_user_id)
		VALUES ($1, 'linkedin', 'member-1', 'Ana', 'member', 'placeholder', now() - interval '1 day', $2)`, companyID, owner)
	later := steps(t, pool, company)
	if !later["first_draft"].Done || !later["account"].Done || later["account"].Status != "1 connected (development stand-in), 1 needs reconnecting" {
		t.Fatalf("an account whose access ran out needs a reconnect: %+v", later["account"])
	}
	if later["plan"].Done || later["first_post"].Done || later["metrics"].Done {
		t.Fatalf("nothing else happened yet: %+v", later)
	}
	other, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	if theirs := steps(t, pool, other); theirs["first_draft"].Done || theirs["account"].Done || theirs["key_facts"].Status != "0 of 16 confirmed" {
		t.Fatalf("another company's progress counted: %+v", theirs)
	}
	overview, _ = Read(ctx, pool, company, true)
	if len(overview.NextSteps) != 1 || overview.NextSteps[0].Label != "Review your business profile" || overview.Strategy.CurrentPlan != nil || len(overview.Strategy.MissingForPlan) != 0 {
		t.Fatalf("everything confirmed: %+v", overview)
	}
}
