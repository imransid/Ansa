package assistant

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/database"
)

// approvedArticle saves an approved support article of one piece, headed by
// its title as the Knowledge page saves it.
func (w *replyWorld) approvedArticle(title, body string) {
	owner := database.TestOwner(w.t, w.pool, w.companyID)
	var articleID string
	err := w.pool.QueryRow(context.Background(), `INSERT INTO knowledge_articles (company_id, title, body, kind, status, created_by_user_id, updated_by_user_id, approved_by_user_id, approved_at)
		VALUES ($1, $2, $3, 'faq', 'approved', $4, $4, $4, now()) RETURNING id`, w.companyID, title, body, owner).Scan(&articleID)
	if err != nil {
		w.t.Fatalf("article: %v", err)
	}
	mustExec(w.t, w.pool, `INSERT INTO knowledge_chunks (company_id, article_id, position, heading, text) VALUES ($1, $2, 0, $3, $4)`, w.companyID, articleID, title, body)
}

// The AI reads an article's title too, so a price written only there may be
// quoted.
func TestAPriceInAnArticlesTitleMayBeQuoted(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"Catering is €15 per person."}`)
	w.approvedArticle("Catering: €15 per person", "We cater weddings, birthdays and office lunches.")
	turn := w.customerSays("ti", "Do you do catering?")
	if got := w.answer(turn); got != OutcomeReplied {
		t.Fatalf("a price the title states may be quoted: %s", got)
	}
}

// A follow-up ("And for 50?") still finds the article the question before it
// asked about, so the AI may repeat that article's price.
func TestAFollowUpKeepsTheArticleOfTheQuestionBefore(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"It's €15 per person for 50 people too."}`)
	w.approvedArticle("Catering", "Catering costs €15 per person, for groups of 20 to 80.")
	w.customerSays("fu", "How much is catering per person?")
	turn := w.customerSays("fu", "And for 50?")
	if got := w.answer(turn); got != OutcomeReplied {
		t.Fatalf("the article's price may be quoted: %s", got)
	}
	if len(w.sent) != 1 || !strings.Contains(w.sent[0].Knowledge, `<article title="Catering">`) {
		t.Fatalf("the brain read the article: %+v", w.sent)
	}
}

// The search reads the customer's newest messages, newest first, and only
// theirs: what the business wrote never picks an article.
func TestTheSearchReadsTheCustomersNewestMessagesNewestFirst(t *testing.T) {
	in := Inputs{Request: BrainRequest{Conversation: []Line{
		{Sender: "customer", Text: "Do you deliver?"},
		{Sender: "customer", Text: "Is there parking?"},
		{Sender: "restaurant", Text: "Our garden is open."},
		{Sender: "customer", Text: "How much is catering?"},
		{Sender: "customer", Text: "And for 50?"},
	}}}
	if got := strings.Join(in.newestCustomerTexts(3), " / "); got != "And for 50? / How much is catering? / Is there parking?" {
		t.Fatalf("newest customer texts: %q", got)
	}
}
