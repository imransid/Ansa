package home

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func TestWhileYouWereAwaySaysAReplyWaitsOnlyWhileOneDoes(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	// ansa's reply to Ana was replaced by a newer one, which waits.
	ana := conversationOf(t, pool, company, "ana")
	assistantWrote(t, pool, companyID, ana, "discarded", "drafted")
	assistantWrote(t, pool, companyID, ana, "draft", "drafted")
	// A teammate sent ansa's reply to Bo: nothing waits there any more.
	bo := conversationOf(t, pool, company, "bo")
	assistantWrote(t, pool, companyID, bo, "sent", "drafted")
	// ansa answered Cy itself.
	cy := conversationOf(t, pool, company, "cy")
	assistantWrote(t, pool, companyID, cy, "sent", "replied")

	summary, err := ReadAwaySummary(context.Background(), pool, company, owner)
	if err != nil {
		t.Fatalf("ReadAwaySummary: %v", err)
	}
	if summary.Waiting != 1 || summary.Replies != 1 || summary.Notes != 0 {
		t.Fatalf("one reply waits, one was sent by ansa: %+v", summary)
	}
	lines := summary.Conversations
	if len(lines) != 2 || lines[0].ConversationID != cy || lines[0].Action != "replied" || lines[1].ConversationID != ana || lines[1].Action != "drafted" {
		t.Fatalf("only Ana's reply still waits (Bo's went): %+v", lines)
	}
}

// An email ansa read and noted, and a finished call that needs you, are
// notes too; a call ansa solved isn't one.
func TestWhileYouWereAwayCountsEmailsAndCallsThatNeedYouAsNotes(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	emailed := conversationOf(t, pool, company, "ed")
	ansaNoted(t, pool, companyID, emailed, "email_made_request")
	called := conversationOf(t, pool, company, "fi")
	ansaNoted(t, pool, companyID, called, "call_needs_person")
	solved := conversationOf(t, pool, company, "gu")
	ansaNoted(t, pool, companyID, solved, "call_solved")

	summary, err := ReadAwaySummary(context.Background(), pool, company, owner)
	if err != nil {
		t.Fatalf("ReadAwaySummary: %v", err)
	}
	if summary.Notes != 2 || summary.Replies != 0 || summary.Waiting != 0 {
		t.Fatalf("two notes: %+v", summary)
	}
	lines := summary.Conversations
	if len(lines) != 2 || lines[0].ConversationID != called || lines[0].Action != "call_needs_person" || lines[1].ConversationID != emailed || lines[1].Action != "email_made_request" {
		t.Fatalf("the call and the email, newest first: %+v", lines)
	}
}

// ansaNoted saves one of ansa's own lines (no message of its own: a call or an email).
func ansaNoted(t *testing.T, pool *database.Pool, companyID, conversationID, action string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `INSERT INTO assistant_activity (company_id, conversation_id, action) VALUES ($1, $2, $3)`, companyID, conversationID, action); err != nil {
		t.Fatalf("saving the line: %v", err)
	}
}

// conversationOf is a stand-in customer's conversation, with their first message.
func conversationOf(t *testing.T, pool *database.Pool, company tenant.CompanyID, externalID string) string {
	t.Helper()
	id, _ := conversations.NewID()
	turn, err := conversations.InsertCustomerMessage(context.Background(), pool, company, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: externalID},
		conversations.IncomingMessage{ID: id, BodyEncrypted: "v1:x:y:z", ChannelMessageID: id})
	if err != nil || turn == nil {
		t.Fatalf("saving the customer's message: %v", err)
	}
	return turn.ConversationID
}

// assistantWrote saves one of ansa's messages, as it is now, and its activity line.
func assistantWrote(t *testing.T, pool *database.Pool, companyID, conversationID, status, action string) {
	t.Helper()
	ctx := context.Background()
	const message = `INSERT INTO messages (company_id, conversation_id, direction, author, body_encrypted, send_status) VALUES ($1, $2, 'out', 'assistant', 'v1:x:y:z', $3)`
	if _, err := pool.Exec(ctx, message, companyID, conversationID, status); err != nil {
		t.Fatalf("saving ansa's message: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO assistant_activity (company_id, conversation_id, action) VALUES ($1, $2, $3)`, companyID, conversationID, action); err != nil {
		t.Fatalf("saving the line: %v", err)
	}
}
