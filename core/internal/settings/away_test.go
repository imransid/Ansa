package settings

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// "I'm away" means ansa answers for you everywhere: a conversation a person
// took over is handed back (the line "Hand back" writes, by whoever pressed
// it), and a message waiting out its minutes is answered at the catch-up's
// next round. Another company's conversations are never touched.
func TestImAwayHandsEveryConversationBackAndEndsEveryWait(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	company, owner := awayCompany(t, pool)
	taken := conversationOf(t, pool, company, "ana")
	takeOver(t, pool, company, taken, owner)
	waiting := conversationOf(t, pool, company, "bo")
	mustExec(t, pool, `UPDATE conversations SET assistant_due_at = now() + interval '10 minutes' WHERE company_id = $1 AND id = $2`, company.String(), waiting)
	other, otherOwner := awayCompany(t, pool)
	theirs := conversationOf(t, pool, other, "cy")
	takeOver(t, pool, other, theirs, otherOwner)
	mustExec(t, pool, `UPDATE conversations SET assistant_due_at = now() + interval '10 minutes' WHERE company_id = $1 AND id = $2`, other.String(), theirs)

	if outcome, err := SetAway(ctx, pool, company, owner, true); err != nil || outcome != Saved {
		t.Fatalf("I'm away: %q %v", outcome, err)
	}
	if handledBy(t, pool, company, taken) != "assistant" {
		t.Fatal("the conversation a person took over is ansa's again")
	}
	handedBack := count(t, pool, `SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND conversation_id = $2 AND action = 'handed_back' AND actor_user_id = $3`, company.String(), taken, owner)
	if handedBack != 1 {
		t.Fatalf("one handed-back line by the owner who pressed it, got %d", handedBack)
	}
	if count(t, pool, `SELECT count(*) FROM conversations WHERE company_id = $1 AND id = $2 AND assistant_due_at <= now()`, company.String(), waiting) != 1 {
		t.Fatal("the waiting message is due now: the catch-up answers it at its next round")
	}
	if handledBy(t, pool, other, theirs) != "person" || count(t, pool, `SELECT count(*) FROM conversations WHERE company_id = $1 AND assistant_due_at > now()`, other.String()) != 1 {
		t.Fatal("another company's conversations stay as they were")
	}
}

// "I'm back" hands nothing back, and a member's "I'm away" changes nothing.
func TestImBackAndAMembersImAwayHandNothingBack(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	company, owner := awayCompany(t, pool)
	taken := conversationOf(t, pool, company, "di")
	takeOver(t, pool, company, taken, owner)
	if outcome, err := SetAway(ctx, pool, company, owner, false); err != nil || outcome != Saved {
		t.Fatalf("I'm back: %q %v", outcome, err)
	}
	member := memberOf(t, pool, company)
	if outcome, err := SetAway(ctx, pool, company, member, true); err != nil || outcome != NotAllowed {
		t.Fatalf("a member: %q %v", outcome, err)
	}
	if handledBy(t, pool, company, taken) != "person" || count(t, pool, `SELECT count(*) FROM assistant_activity WHERE company_id = $1`, company.String()) != 0 {
		t.Fatal("the conversation stays taken over, with no line")
	}
}

func awayCompany(t *testing.T, pool *database.Pool) (tenant.CompanyID, string) {
	t.Helper()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	return company, database.TestOwner(t, pool, companyID)
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

func takeOver(t *testing.T, pool *database.Pool, company tenant.CompanyID, conversationID, userID string) {
	t.Helper()
	mustExec(t, pool, `UPDATE conversations SET handled_by = 'person', taken_over_by_user_id = $3, taken_over_at = now() WHERE company_id = $1 AND id = $2`,
		company.String(), conversationID, userID)
}

func memberOf(t *testing.T, pool *database.Pool, company tenant.CompanyID) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (id, company_id, role, name, email, email_verified)
		VALUES ('id' || substr(md5(random()::text) || md5(random()::text), 1, 30), $1, 'member', 'Core Test Member', gen_random_uuid()::text || '@core-test.example', true)
		RETURNING id`, company.String()).Scan(&id)
	if err != nil {
		t.Fatalf("making a member: %v", err)
	}
	return id
}

func handledBy(t *testing.T, pool *database.Pool, company tenant.CompanyID, conversationID string) string {
	t.Helper()
	var handler string
	if err := pool.QueryRow(context.Background(), `SELECT handled_by FROM conversations WHERE company_id = $1 AND id = $2`, company.String(), conversationID).Scan(&handler); err != nil {
		t.Fatalf("reading the conversation: %v", err)
	}
	return handler
}

func count(t *testing.T, pool *database.Pool, statement string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), statement, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func mustExec(t *testing.T, pool *database.Pool, statement string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), statement, args...); err != nil {
		t.Fatalf("%s: %v", statement, err)
	}
}
