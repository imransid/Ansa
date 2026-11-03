package teammates

import (
	"context"
	"testing"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

type teamWorld struct {
	t       *testing.T
	pool    *database.Pool
	company tenant.CompanyID
	ownerA  string
}

func newTeamWorld(t *testing.T) *teamWorld {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	return &teamWorld{t: t, pool: pool, company: company, ownerA: database.TestOwner(t, pool, companyID)}
}

func (w *teamWorld) exec(statement string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

func (w *teamWorld) count(statement string, args ...any) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, append([]any{w.company.String()}, args...)...).Scan(&n); err != nil {
		w.t.Fatalf("count: %v", err)
	}
	return n
}

func TestACompanyAlwaysKeepsAnOwner(t *testing.T) {
	w := newTeamWorld(t)
	ctx := context.Background()
	ownerB := database.TestOwner(t, w.pool, w.company.String())
	token, outcome, _ := CreateInvite(ctx, w.pool, w.company, ownerB, "friend@example.com", "owner", time.Now())
	if outcome != "created" || token == "" || w.count(`SELECT count(*) FROM invites WHERE company_id = $1 AND token_hash = $2`, HashInviteToken(token)) != 1 {
		t.Fatalf("invite: %s", outcome)
	}
	if changed, _ := SetRole(ctx, w.pool, w.company, w.ownerA, w.ownerA, "member"); changed {
		t.Fatal("never your own role")
	}
	if changed, err := SetRole(ctx, w.pool, w.company, w.ownerA, ownerB, "member"); err != nil || !changed {
		t.Fatalf("demote: %v", err)
	}
	if w.count(`SELECT count(*) FROM invites WHERE company_id = $1 AND revoked_at IS NOT NULL`) != 1 {
		t.Fatal("a demoted owner's pending invites are revoked")
	}
	if changed, _ := SetRole(ctx, w.pool, w.company, ownerB, w.ownerA, "member"); changed {
		t.Fatal("a member changes no role")
	}
	if _, outcome, _ := CreateInvite(ctx, w.pool, w.company, ownerB, "other@example.com", "owner", time.Now()); outcome != "not-allowed" {
		t.Fatal("a member invites nobody")
	}
	if _, outcome, _ := CreateInvite(ctx, w.pool, w.company, w.ownerA, "friend@example.com", "member", time.Now()); outcome != "created" {
		t.Fatal("an owner invites again")
	}
	var memberEmail string
	w.pool.QueryRow(ctx, `SELECT email FROM users WHERE company_id = $1 AND id = $2`, w.company.String(), ownerB).Scan(&memberEmail)
	if _, outcome, _ := CreateInvite(ctx, w.pool, w.company, w.ownerA, memberEmail, "member", time.Now()); outcome != "taken" {
		t.Fatal("an address on the team can't be invited")
	}
	var inviteID string
	w.pool.QueryRow(ctx, `SELECT id FROM invites WHERE company_id = $1 AND revoked_at IS NULL`, w.company.String()).Scan(&inviteID)
	if revoked, _ := RevokeInvite(ctx, w.pool, w.company, inviteID); !revoked {
		t.Fatal("revoke")
	}
	if again, _ := RevokeInvite(ctx, w.pool, w.company, inviteID); again {
		t.Fatal("a revoked invite is no longer pending")
	}
}

func TestARemovedTeammatesRequestsGoToTheNextExpert(t *testing.T) {
	w := newTeamWorld(t)
	ctx := context.Background()
	leaving := database.TestOwner(t, w.pool, w.company.String())
	staying := database.TestOwner(t, w.pool, w.company.String())
	w.exec(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id IN ($2, $3)`, w.company.String(), leaving, staying)
	if outcome, _ := CreateCategory(ctx, w.pool, w.company, "Orders"); outcome != "created" {
		t.Fatal("category")
	}
	if outcome, _ := CreateCategory(ctx, w.pool, w.company, "ORDERS"); outcome != "name-taken" {
		t.Fatal("a name in any case is taken")
	}
	var categoryID string
	w.pool.QueryRow(ctx, `SELECT id FROM categories WHERE company_id = $1`, w.company.String()).Scan(&categoryID)
	if saved, _ := SaveCategoriesOf(ctx, w.pool, w.company, leaving, []string{categoryID, "00000000-0000-4000-8000-000000000000"}); saved {
		t.Fatal("an unknown category refuses the whole save")
	}
	for _, person := range []string{leaving, staying} {
		if saved, err := SaveCategoriesOf(ctx, w.pool, w.company, person, []string{categoryID}); err != nil || !saved {
			t.Fatalf("categories: %v", err)
		}
	}
	w.exec(`INSERT INTO tickets (company_id, ticket_number, subject, description, channel, category, assigned_to_user_id, assigned_automatically) VALUES ($1, 1, 's', 'd', 'manual', 'Orders', $2, true)`, w.company.String(), leaving)
	token, _ := conversations.NewID()
	w.exec(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, leaving)
	if removed, err := Remove(ctx, w.pool, w.company, w.ownerA, leaving); err != nil || !removed {
		t.Fatalf("remove: %v", err)
	}
	var assignee string
	w.pool.QueryRow(ctx, `SELECT assigned_to_user_id FROM tickets WHERE company_id = $1`, w.company.String()).Scan(&assignee)
	var sessions int
	w.pool.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE user_id = $1`, leaving).Scan(&sessions)
	if assignee != staying || sessions != 0 || w.count(`SELECT count(*) FROM user_categories WHERE company_id = $1 AND user_id = $2`, leaving) != 0 {
		t.Fatalf("their request went to %s, %d logins left", assignee, sessions)
	}
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'ticket.assigned'`) != 1 {
		t.Fatal("the new expert is emailed after commit")
	}
	team, _ := ReadTeam(ctx, w.pool, w.company, true)
	if len(team.Removed) != 1 || team.Removed[0].ID != leaving || len(team.Members) != 2 {
		t.Fatalf("the team: %d on it, %d removed", len(team.Members), len(team.Removed))
	}
	if again, _ := Remove(ctx, w.pool, w.company, w.ownerA, leaving); again {
		t.Fatal("removed once")
	}
}

func TestSomeoneWhoNeverConfirmedIsDeletedAndRestoringRoutesWaitingRequests(t *testing.T) {
	w := newTeamWorld(t)
	ctx := context.Background()
	typo := database.TestOwner(t, w.pool, w.company.String())
	expert := database.TestOwner(t, w.pool, w.company.String())
	w.exec(`UPDATE users SET email_verified = false, role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), typo)
	if removed, err := Remove(ctx, w.pool, w.company, w.ownerA, typo); err != nil || !removed {
		t.Fatalf("remove: %v", err)
	}
	if w.count(`SELECT count(*) FROM users WHERE company_id = $1 AND id = $2`, typo) != 0 {
		t.Fatal("an account that never confirmed is deleted")
	}
	CreateCategory(ctx, w.pool, w.company, "Refunds")
	var categoryID string
	w.pool.QueryRow(ctx, `SELECT id FROM categories WHERE company_id = $1`, w.company.String()).Scan(&categoryID)
	SaveCategoriesOf(ctx, w.pool, w.company, expert, []string{categoryID})
	SetCategoryArchived(ctx, w.pool, w.company, categoryID, true)
	w.exec(`INSERT INTO tickets (company_id, ticket_number, subject, description, channel, category) VALUES ($1, 7, 's', 'd', 'manual', 'Refunds')`, w.company.String())
	if outcome, _ := RenameCategory(ctx, w.pool, w.company, categoryID, "Money back"); outcome != "renamed" {
		t.Fatal("rename")
	}
	if outcome, err := SetCategoryArchived(ctx, w.pool, w.company, categoryID, false); err != nil || outcome != "changed" {
		t.Fatalf("restore: %s %v", outcome, err)
	}
	var assignee, category string
	w.pool.QueryRow(ctx, `SELECT assigned_to_user_id, category FROM tickets WHERE company_id = $1`, w.company.String()).Scan(&assignee, &category)
	if assignee != expert || category != "Money back" {
		t.Fatalf("restoring routes the waiting request (renamed with it): %s %s", assignee, category)
	}
}

// Step 57: an invite needs a seat in the package (people and pending
// invites counted): the free trial has 3.
func TestAnInviteNeedsASeatInThePackage(t *testing.T) {
	w := newTeamWorld(t)
	ctx := context.Background()
	for _, address := range []string{"one@core-test.example", "two@core-test.example"} {
		if _, outcome, err := CreateInvite(ctx, w.pool, w.company, w.ownerA, address, "member", time.Now()); err != nil || outcome != "created" {
			t.Fatalf("%s: %q %v", address, outcome, err)
		}
	}
	if _, outcome, err := CreateInvite(ctx, w.pool, w.company, w.ownerA, "three@core-test.example", "member", time.Now()); err != nil || outcome != "team-full" {
		t.Fatalf("the owner and two invites fill the trial's 3 seats: %q %v", outcome, err)
	}
	if w.count(`SELECT count(*) FROM invites WHERE company_id = $1`) != 2 {
		t.Fatal("nothing saved past the seats")
	}
}

// Inviting an address again replaces its pending invite (the newest link is
// the one that works), so one person never takes two seats.
func TestInvitingAnAddressAgainReplacesItsPendingInvite(t *testing.T) {
	w := newTeamWorld(t)
	ctx := context.Background()
	CreateInvite(ctx, w.pool, w.company, w.ownerA, "one@core-test.example", "member", time.Now())
	first, _, _ := CreateInvite(ctx, w.pool, w.company, w.ownerA, "two@core-test.example", "member", time.Now())
	second, outcome, err := CreateInvite(ctx, w.pool, w.company, w.ownerA, "two@core-test.example", "owner", time.Now())
	if err != nil || outcome != "created" {
		t.Fatalf("the same address again, with the trial's 3 seats taken: %q %v", outcome, err)
	}
	const pending = `SELECT count(*) FROM invites WHERE company_id = $1 AND token_hash = $2 AND revoked_at IS NULL`
	if w.count(pending, HashInviteToken(first)) != 0 || w.count(pending, HashInviteToken(second)) != 1 {
		t.Fatal("the first link stops working, the newest one works")
	}
	if w.count(`SELECT count(*) FROM invites WHERE company_id = $1 AND email = 'one@core-test.example' AND revoked_at IS NULL`) != 1 {
		t.Fatal("another address's invite stays")
	}
	// Two people joined meanwhile (or the package got smaller): the team is
	// full even without that invite, and nothing changes.
	database.TestOwner(t, w.pool, w.company.String())
	database.TestOwner(t, w.pool, w.company.String())
	if _, outcome, err := CreateInvite(ctx, w.pool, w.company, w.ownerA, "two@core-test.example", "member", time.Now()); err != nil || outcome != "team-full" {
		t.Fatalf("a full team: %q %v", outcome, err)
	}
	if w.count(pending, HashInviteToken(second)) != 1 {
		t.Fatal("a refused invite keeps the pending one working")
	}
}
