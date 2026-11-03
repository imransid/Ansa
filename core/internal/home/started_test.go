package home

import (
	"context"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// A Facebook Page whose messages come to ansa is where people write too, as
// Settings → Connections says ("Messages come to ansa": Messenger allowed
// on the Page, or the development stand-in Page), while the package
// includes Messenger. A Page that only posts isn't one.
func TestAFacebookPageWhoseMessagesComeToAnsaIsAChannel(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
	exec(`INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id, scopes)
		VALUES ($1, 'facebook', '90901', 'Rafa Designs', 'page', 'v1:x:y:z', $2, ARRAY['pages_show_list', 'pages_manage_posts'])`, companyID, owner)
	if step := channelStepOf(t, pool, company); step.Done {
		t.Fatalf("a Page that only posts: %+v", step)
	}
	exec(`UPDATE social_connections SET scopes = ARRAY['pages_show_list', 'pages_manage_posts', 'pages_messaging', 'pages_manage_metadata'] WHERE company_id = $1`, companyID)
	if step := channelStepOf(t, pool, company); !step.Done || step.DoneText != "Facebook Messenger is connected." {
		t.Fatalf("a Page whose messages come to ansa: %+v", step)
	}
	exec(`INSERT INTO company_billing (company_id, stripe_customer_id, stripe_subscription_id, status, package) VALUES ($1, $2, $3, 'active', 'personal')`,
		companyID, "cus_"+companyID, "sub_"+companyID)
	if step := channelStepOf(t, pool, company); step.Done {
		t.Fatalf("a package without Messenger: %+v", step)
	}
	exec(`UPDATE company_billing SET package = 'business' WHERE company_id = $1`, companyID)
	exec(`UPDATE social_connections SET external_account_id = 'dev:stand-in', is_stand_in = true, scopes = '{}' WHERE company_id = $1`, companyID)
	if step := channelStepOf(t, pool, company); !step.Done || step.DoneText != "A stand-in Facebook Page is connected (development)." {
		t.Fatalf("the stand-in Page: %+v", step)
	}
}

// channelStepOf is the owner's first Getting started step (no menu yet, so
// the list is never empty).
func channelStepOf(t *testing.T, pool *database.Pool, company tenant.CompanyID) Step {
	t.Helper()
	steps, err := GettingStarted(context.Background(), pool, company, "owner", BrainStatus{AnsaKey: true}, time.Now())
	if err != nil || len(steps) == 0 || steps[0].Key != "channel" {
		t.Fatalf("GettingStarted: %+v %v", steps, err)
	}
	return steps[0]
}
