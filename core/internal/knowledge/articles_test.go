package knowledge

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func TestPiecesAreWholeParagraphsAndLongOnesCutBetweenSentences(t *testing.T) {
	pieces := PackParagraphs("First.\n\n  Second paragraph.  \n\n\n"+strings.Repeat("A sentence here. ", 10), 60)
	if len(pieces) < 3 || pieces[0] != "First.\n\nSecond paragraph." {
		t.Fatalf("pieces: %q", pieces)
	}
	for _, piece := range pieces {
		if len([]rune(piece)) > 60 || strings.TrimSpace(piece) != piece || !strings.HasSuffix(piece, ".") {
			t.Errorf("piece %q", piece)
		}
	}
	if got := PackParagraphs(strings.Repeat("x", 25), 10); len(got) != 3 || got[2] != "xxxxx" {
		t.Errorf("no space at all: %q", got)
	}
}

func TestAnImportBecomesTitledParts(t *testing.T) {
	text := strings.Repeat("Paragraph of the returns policy.\n\n", 1000)
	parts, wasCut := SplitImported(text, "Returns\npolicy.pdf")
	if wasCut || len(parts) != 2 || parts[0].Title != "Returns policy.pdf (part 1 of 2)" || len([]rune(parts[0].Body)) > 20_000 {
		t.Fatalf("parts: %d %v %q", len(parts), wasCut, parts[0].Title)
	}
	if _, wasCut := SplitImported(strings.Repeat("word ", 50_000), "x"); !wasCut {
		t.Fatal("past 200,000 characters the end is left out")
	}
	// A tab at a line's end goes too, as in the old code.
	if NormalizeExtracted("a \r\nb\x00\x07\t\n\n\n\nc  ") != "a\nb\n\nc" {
		t.Fatalf("normalized: %q", NormalizeExtracted("a \r\nb\x00\x07\t\n\n\n\nc  "))
	}
}

func TestDraftsApprovalsAndWhoMayDoWhat(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	member := database.TestOwner(t, pool, companyID)
	pool.Exec(ctx, `UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, companyID, member)
	fields := Fields{Title: "Refunds", Body: "Refunds take 5 days.", Kind: "policy", UseForSupport: true}
	ids, outcome, err := CreateDrafts(ctx, pool, company, member, []Fields{fields}, Source{})
	if err != nil || outcome != "created" || len(ids) != 1 {
		t.Fatalf("a member writes a draft: %s %v", outcome, err)
	}
	if _, outcome, _ := CreateDrafts(ctx, pool, company, member, []Fields{fields}, Source{URL: "https://x.example"}); outcome != "refused" {
		t.Fatal("imports are owners' only")
	}
	id := ids[0]
	if outcome, _ := ChangeStatus(ctx, pool, company, member, id, "approve", 1); outcome != "not-allowed" {
		t.Fatal("only owners approve")
	}
	fields.Body = "Refunds take 3 days."
	if outcome, _ := Edit(ctx, pool, company, member, id, 1, fields); outcome != "changed" {
		t.Fatal("anyone edits a draft")
	}
	if outcome, _ := ChangeStatus(ctx, pool, company, owner, id, "approve", 1); outcome != "stale" {
		t.Fatal("the owner approves only the words they saw")
	}
	if outcome, _ := ChangeStatus(ctx, pool, company, owner, id, "approve", 2); outcome != "changed" {
		t.Fatal("approve")
	}
	if hits, _ := Search(ctx, pool, company, "how long do refunds take", "support", 3); len(hits) != 1 || hits[0].Text != "Refunds take 3 days." {
		t.Fatalf("the approved text is found: %+v", hits)
	}
	if outcome, _ := Edit(ctx, pool, company, member, id, 2, fields); outcome != "not-allowed" {
		t.Fatal("only owners change an approved article")
	}
	detail, _ := Read(ctx, pool, company, id)
	if detail == nil || detail.Status != "approved" || detail.ApprovedByName == nil || detail.Pieces != 1 {
		t.Fatalf("detail: %+v", detail)
	}
	if outcome, _ := ChangeStatus(ctx, pool, company, owner, id, "restore", 0); outcome != "wrong-status" {
		t.Fatal("only an archived article is restored")
	}
	if outcome, _ := Delete(ctx, pool, company, member, id); outcome != "not-allowed" {
		t.Fatal("only owners delete")
	}
	if outcome, _ := Delete(ctx, pool, company, owner, id); outcome != "deleted" {
		t.Fatal("delete")
	}
	if counts, _ := Counts(ctx, pool, company, ""); counts["all"] != 0 {
		t.Fatal("gone with its pieces")
	}
}
