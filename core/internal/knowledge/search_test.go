package knowledge

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func TestOnlyWordsReachTheQuery(t *testing.T) {
	cases := map[string]string{
		"How long do refunds take?":    "long:* | refunds:* | take:*",
		"refund & !x | (y) 'z' <-> ab": "refund:* | ab",
		"ﬁx ＡＢ":                        "fix | ab",
		"how do I?":                    "",
	}
	for text, want := range cases {
		if got := BuildTsQuery(text); got != want {
			t.Errorf("%q: got %q, want %q", text, got, want)
		}
	}
	var many []string
	for i := 0; i < 30; i++ {
		many = append(many, "w"+strconv.Itoa(i))
	}
	if words := strings.Count(BuildTsQuery(strings.Join(many, " ")), "|") + 1; words != 20 {
		t.Errorf("at most 20 words: %d", words)
	}
}

func TestOnlyTheCompanysApprovedArticlesForTheAudienceAreFound(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	otherID := database.TestCompany(t, pool)
	otherOwner := database.TestOwner(t, pool, otherID)
	article := func(company, owner, status, title, text string, support bool) {
		var id string
		err := pool.QueryRow(ctx, `INSERT INTO knowledge_articles (company_id, title, body, kind, status, use_for_support, created_by_user_id, updated_by_user_id, approved_by_user_id, approved_at)
			VALUES ($1, $2, $3, 'faq', $4, $5, $6::uuid, $6::uuid, CASE WHEN $4 = 'approved' THEN $6::uuid END, CASE WHEN $4 = 'approved' THEN now() END) RETURNING id`,
			company, title, text, status, support, owner).Scan(&id)
		if err != nil {
			t.Fatalf("article: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO knowledge_chunks (company_id, article_id, position, heading, text) VALUES ($1, $2, 0, $3, $4)`, company, id, title, text); err != nil {
			t.Fatalf("chunk: %v", err)
		}
	}
	article(companyID, owner, "approved", "Refunds", "Refunds take <5> days & arrive on your card.", true)
	article(companyID, owner, "draft", "Refund draft", "Refunds are instant.", true)
	article(companyID, owner, "approved", "Refund marketing", "Refunds sell.", false)
	article(otherID, otherOwner, "approved", "Their refunds", "Refunds take 30 days.", true)
	hits, err := Search(ctx, pool, company, "How long do refunds take?", "support", 3)
	if err != nil || len(hits) != 1 || hits[0].Title != "Refunds" {
		t.Fatalf("hits: %+v %v", hits, err)
	}
	kept, text := Slice(hits, 3000)
	if len(kept) != 1 || text != "<article title=\"Refunds\">\nRefunds take &lt;5&gt; days &amp; arrive on your card.\n</article>" {
		t.Fatalf("slice: %q", text)
	}
	if kept, text := Slice(hits, 20); len(kept) != 0 || text != "" {
		t.Fatal("a piece that doesn't fit is left out whole")
	}
}
