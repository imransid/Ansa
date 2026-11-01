package studio

import (
	"context"
	"sync"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/tenant"
)

func TestAnApprovalRecordsItsVersionAndAnEditTakesItAway(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	w.confirm("description", "A bakery since 1998")
	id := w.draft("linkedin", "post", "Fresh bread every morning.", backedClaim, sentFacts)
	result, err := Approve(ctx, w.pool, w.company, w.owner, id, 1, false)
	if err != nil || result.Outcome != Approved {
		t.Fatalf("a backed draft is approved without the tick: %+v %v", result, err)
	}
	status, version, approvedVersion, approvedBy, acknowledgedBy, _ := w.row(id)
	if status != "approved" || version != 1 || approvedVersion == nil || *approvedVersion != 1 || *approvedBy != w.owner || acknowledgedBy != nil {
		t.Fatalf("the approval records its version: %s %d %v", status, version, approvedVersion)
	}
	place := Placement{Topic: "Our bread"}
	same := drafts.Fields{Body: "Fresh bread every morning.", Hashtags: []string{}}
	if outcome, _ := Edit(ctx, w.pool, w.company, w.member, id, 1, place, same); outcome != Unchanged {
		t.Fatalf("an edit changing nothing keeps the approval: %s", outcome)
	}
	changed := drafts.Fields{Body: "Fresh bread every morning, from 7.", Hashtags: []string{}}
	if outcome, _ := Edit(ctx, w.pool, w.company, w.member, id, 1, place, changed); outcome != Changed {
		t.Fatalf("an edit is saved: %s", outcome)
	}
	status, version, approvedVersion, approvedBy, _, _ = w.row(id)
	if status != "draft" || version != 2 || approvedVersion != nil || approvedBy != nil {
		t.Fatalf("an edit makes it a draft again, as the next version, without its approval: %s %d", status, version)
	}
	if outcome, _ := Edit(ctx, w.pool, w.company, w.member, id, 1, place, same); outcome != Stale {
		t.Fatalf("an edit of a version that moved on is refused: %s", outcome)
	}
	if result, _ := Approve(ctx, w.pool, w.company, w.owner, id, 1, true); result.Outcome != Stale {
		t.Fatalf("an approval of a version that moved on is refused: %s", result.Outcome)
	}
	if outcome, _ := Reject(ctx, w.pool, w.company, w.owner, id, 1, nil); outcome != Stale {
		t.Fatalf("a rejection of a version that moved on is refused: %s", outcome)
	}
}

func TestOfFiveEditsAtTheSameMomentExactlyOneWins(t *testing.T) {
	w := newStudioWorld(t)
	id := w.draft("facebook", "post", "Bread.", nil, nil)
	var wins, stale int
	var mu sync.Mutex
	var group sync.WaitGroup
	for i := range 5 {
		group.Add(1)
		go func() {
			defer group.Done()
			body := drafts.Fields{Body: "Bread number " + string(rune('A'+i)), Hashtags: []string{}}
			outcome, err := Edit(context.Background(), w.pool, w.company, w.member, id, 1, Placement{Topic: "Our bread"}, body)
			mu.Lock()
			defer mu.Unlock()
			if err == nil && outcome == Changed {
				wins++
			} else if outcome == Stale {
				stale++
			}
		}()
	}
	group.Wait()
	if wins != 1 || stale != 4 {
		t.Fatalf("exactly one save wins: %d won, %d stale", wins, stale)
	}
}

func TestMembersWriteButOnlyOwnersApproveOrReject(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	w.confirm("description", "A bakery since 1998")
	id := w.draft("linkedin", "post", "Fresh bread.", backedClaim, sentFacts)
	if result, _ := Approve(ctx, w.pool, w.company, w.member, id, 1, true); result.Outcome != NotAllowed {
		t.Fatalf("a member can't approve: %s", result.Outcome)
	}
	if outcome, _ := Reject(ctx, w.pool, w.company, w.member, id, 1, nil); outcome != NotAllowed {
		t.Fatalf("a member can't reject: %s", outcome)
	}
	if outcome, _ := Archive(ctx, w.pool, w.company, w.member, id); outcome != Changed {
		t.Fatalf("a member archives: %s", outcome)
	}
	if outcome, _ := Restore(ctx, w.pool, w.company, w.member, id); outcome != Changed {
		t.Fatalf("a member restores: %s", outcome)
	}
	// An owner made a member meanwhile: their role is read again inside the write.
	w.exec(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), w.owner)
	if result, _ := Approve(ctx, w.pool, w.company, w.owner, id, 1, true); result.Outcome != NotAllowed {
		t.Fatalf("an owner made a member is refused: %s", result.Outcome)
	}
}

func TestAClaimNoFactBacksNeedsTheOwnersTick(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	w.confirm("description", "A bakery since 1998")
	unbacked := []drafts.StoredClaim{{Text: "Best in town", Supported: false, FactTopics: []string{}}}
	id := w.draft("linkedin", "post", "The best bread in town.", unbacked, sentFacts)
	if result, _ := Approve(ctx, w.pool, w.company, w.owner, id, 1, false); result.Outcome != ClaimsNotChecked {
		t.Fatalf("an unbacked claim needs the tick: %s", result.Outcome)
	}
	if result, _ := Approve(ctx, w.pool, w.company, w.owner, id, 1, true); result.Outcome != Approved {
		t.Fatalf("with the tick it is approved: %s", result.Outcome)
	}
	if _, _, _, _, acknowledgedBy, _ := w.row(id); acknowledgedBy == nil || *acknowledgedBy != w.owner {
		t.Fatal("the owner who ticked it is recorded")
	}
	// A fact changed since the draft was written: its claim is no longer backed.
	backed := w.draft("linkedin", "post", "Baking since 1998.", backedClaim, sentFacts)
	w.confirm("description", "A bakery since 1999")
	if result, _ := Approve(ctx, w.pool, w.company, w.owner, backed, 1, false); result.Outcome != ClaimsNotChecked {
		t.Fatalf("a fact changed since needs the tick: %s", result.Outcome)
	}
	// A text written by hand: no code listed its claims.
	byHand, _, _ := Create(ctx, w.pool, w.company, w.member, NewDraft{Platform: "linkedin", Format: "post", Placement: Placement{Topic: "Hand"}}, nil)
	Edit(ctx, w.pool, w.company, w.member, byHand, 1, Placement{Topic: "Hand"}, drafts.Fields{Body: "Typed by hand.", Hashtags: []string{}})
	if result, _ := Approve(ctx, w.pool, w.company, w.owner, byHand, 2, false); result.Outcome != ClaimsNotChecked {
		t.Fatalf("a text written by hand needs the tick: %s", result.Outcome)
	}
}

func TestARejectionKeepsItsNoteUntilAnApproval(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	id := w.draft("facebook", "post", "Bread.", nil, nil)
	note := "Say when we open."
	if outcome, _ := Reject(ctx, w.pool, w.company, w.owner, id, 1, &note); outcome != Changed {
		t.Fatalf("an owner rejects: %s", outcome)
	}
	Edit(ctx, w.pool, w.company, w.member, id, 1, Placement{Topic: "Our bread"}, drafts.Fields{Body: "Bread from 7.", Hashtags: []string{}})
	if status, _, _, _, _, kept := w.row(id); status != "draft" || kept == nil || *kept != note {
		t.Fatalf("the note stays through an edit: %s %v", status, kept)
	}
	Approve(ctx, w.pool, w.company, w.owner, id, 2, true)
	if status, _, _, _, _, kept := w.row(id); status != "approved" || kept != nil {
		t.Fatalf("an approval ends the rejection: %s %v", status, kept)
	}
	if outcome, _ := Reject(ctx, w.pool, w.company, w.owner, id, 2, nil); outcome != Changed {
		t.Fatalf("an approved draft can be rejected: %s", outcome)
	}
	if _, _, approvedVersion, _, _, _ := w.row(id); approvedVersion != nil {
		t.Fatal("a rejected draft loses its approval")
	}
	idea, _, _ := Create(ctx, w.pool, w.company, w.member, NewDraft{Platform: "x", Format: "post", Placement: Placement{Topic: "Later"}}, nil)
	if outcome, _ := Reject(ctx, w.pool, w.company, w.owner, idea, 1, nil); outcome != WrongStatus {
		t.Fatalf("an idea can't be decided on: %s", outcome)
	}
}

func TestArchiveTakesTheApprovalAwayAndRestoreMakesADraft(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	id := w.draft("facebook", "post", "Bread.", nil, nil)
	Approve(ctx, w.pool, w.company, w.owner, id, 1, true)
	if outcome, _ := Archive(ctx, w.pool, w.company, w.member, id); outcome != Changed {
		t.Fatalf("archived: %s", outcome)
	}
	if status, _, approvedVersion, _, _, _ := w.row(id); status != "archived" || approvedVersion != nil {
		t.Fatalf("an archive takes the approval away: %s", status)
	}
	current, _ := drafts.List(ctx, w.pool, w.company, "current", "all", 1)
	if len(current) != 0 {
		t.Fatal("an archived draft is out of the current list")
	}
	if result, _ := Approve(ctx, w.pool, w.company, w.owner, id, 1, true); result.Outcome != WrongStatus {
		t.Fatalf("an archived draft can't be approved: %s", result.Outcome)
	}
	Restore(ctx, w.pool, w.company, w.member, id)
	if status, _, _, _, _, _ := w.row(id); status != "draft" {
		t.Fatalf("restored as a draft: %s", status)
	}
	idea, _, _ := Create(ctx, w.pool, w.company, w.member, NewDraft{Platform: "x", Format: "post", Placement: Placement{Topic: "Later"}}, nil)
	Archive(ctx, w.pool, w.company, w.member, idea)
	Restore(ctx, w.pool, w.company, w.member, idea)
	if status, _, _, _, _, _ := w.row(idea); status != "idea" {
		t.Fatalf("an empty draft is restored as an idea: %s", status)
	}
}

func TestAnotherCompanyFindsNoneOfItsDrafts(t *testing.T) {
	w := newStudioWorld(t)
	ctx := context.Background()
	id := w.draft("facebook", "post", "Bread.", nil, nil)
	otherID := database.TestCompany(t, w.pool)
	other, _ := tenant.FromTrustedSource(otherID)
	stranger := database.TestOwner(t, w.pool, otherID)
	if page, err := ReadPage(ctx, w.pool, other, id); err != nil || page != nil {
		t.Fatal("another company can't read the draft")
	}
	if list, _ := drafts.List(ctx, w.pool, other, "current", "all", 1); len(list) != 0 {
		t.Fatal("another company can't list it")
	}
	if outcome, _ := Edit(ctx, w.pool, other, stranger, id, 1, Placement{Topic: "Mine"}, drafts.Fields{Body: "Mine", Hashtags: []string{}}); outcome != NotFound {
		t.Fatalf("another company can't edit it: %s", outcome)
	}
	if result, _ := Approve(ctx, w.pool, other, stranger, id, 1, true); result.Outcome != NotFound {
		t.Fatalf("another company can't approve it: %s", result.Outcome)
	}
	for _, change := range []func(context.Context, *database.Pool, tenant.CompanyID, string, string) (string, error){Archive, Restore} {
		if outcome, _ := change(ctx, w.pool, other, stranger, id); outcome != NotFound {
			t.Fatalf("another company can't archive or restore it: %s", outcome)
		}
	}
	if status, version, _, _, _, _ := w.row(id); status != "draft" || version != 1 {
		t.Fatal("nothing changed")
	}
}
