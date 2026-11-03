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

// The index lower-cases with ICU (full case mapping), so the query must
// too: "İ" is "i" with a combining dot above, and a "Σ" ending a word is "ς".
func TestCapitalsAreLowerCasedAsTheIndexLowerCasesThem(t *testing.T) {
	cases := map[string]string{
		"İSTANBUL":   "i\u0307stanbul:*",
		"ΟΔΟΣ ΕΡΜΟΥ": "οδος:* | ερμου:*",
	}
	for text, want := range cases {
		if got := BuildTsQuery(text); got != want {
			t.Errorf("%q: got %q, want %q", text, got, want)
		}
	}
	if got := CombineSearchTexts([]string{"ΟΔΟΣ", "İSTANBUL"}); got != "οδος i\u0307stanbul" {
		t.Errorf("combined: got %q", got)
	}
}

// "Is there almond in the kacchi?": "is there" (আছে) and "what" (কি) say
// nothing about what is asked, as "is" and "what" don't in English.
func TestCommonBanglaWordsAreLeftOut(t *testing.T) {
	if got := BuildTsQuery("কাচ্চিতে কি বাদাম আছে?"); got != "কাচ্চিতে:* | বাদাম:*" {
		t.Errorf("got %q", got)
	}
	if got := BuildTsQuery("আপনারা কী করেন এবং আমি না হ্যাঁ"); got != "" {
		t.Errorf("only stop words: got %q", got)
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
	addArticle(t, pool, companyID, owner, "approved", "Refunds", "Refunds take <5> days & arrive on your card.", true)
	addArticle(t, pool, companyID, owner, "draft", "Refund draft", "Refunds are instant.", true)
	addArticle(t, pool, companyID, owner, "approved", "Refund marketing", "Refunds sell.", false)
	addArticle(t, pool, otherID, otherOwner, "approved", "Their refunds", "Refunds take 30 days.", true)
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

// A question finds what Postgres indexed, in every script: in capitals, and
// in Bangla without its common words matching any article that has them.
func TestQuestionsInCapitalsAndInBanglaFindWhatTheyAsk(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	addArticle(t, pool, companyID, owner, "approved", "Our shop", "We are in İstanbul, near the Galata tower.", true)
	addArticle(t, pool, companyID, owner, "approved", "Η διεύθυνση", "ΟΔΟΣ ΕΡΜΟΥ 12, Αθήνα.", true)
	addArticle(t, pool, companyID, owner, "approved", "পার্কিং", "সন্ধ্যায় রাস্তায় পার্কিং আছে।", true)
	for question, want := range map[string]string{"İSTANBUL": "Our shop", "ΟΔΟΣ": "Η διεύθυνση", "কাচ্চিতে কি বাদাম আছে?": ""} {
		hits, err := Search(ctx, pool, company, question, "support", 3)
		var titles []string
		for _, hit := range hits {
			titles = append(titles, hit.Title)
		}
		if err != nil || strings.Join(titles, ", ") != want {
			t.Errorf("%q: found %q, want %q (%v)", question, titles, want, err)
		}
	}
}

// addArticle saves an article with its one piece, which Postgres indexes.
func addArticle(t *testing.T, pool *database.Pool, company, owner, status, title, text string, support bool) {
	t.Helper()
	ctx := context.Background()
	var id string
	err := pool.QueryRow(ctx, `INSERT INTO knowledge_articles (company_id, title, body, kind, status, use_for_support, created_by_user_id, updated_by_user_id, approved_by_user_id, approved_at)
		VALUES ($1, $2, $3, 'faq', $4, $5, $6::text, $6::text, CASE WHEN $4 = 'approved' THEN $6::text END, CASE WHEN $4 = 'approved' THEN now() END) RETURNING id`,
		company, title, text, status, support, owner).Scan(&id)
	if err != nil {
		t.Fatalf("article: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_chunks (company_id, article_id, position, heading, text) VALUES ($1, $2, 0, $3, $4)`, company, id, title, text); err != nil {
		t.Fatalf("chunk: %v", err)
	}
}
