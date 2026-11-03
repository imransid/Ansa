package api

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/session"
)

func TestTheInboxThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	ctx := context.Background()
	var conversationID string
	w.pool.QueryRow(ctx, `SELECT id FROM conversations WHERE company_id = $1`, w.company.String()).Scan(&conversationID)
	messageID, _ := conversations.NewID()
	body, _ := box.Encrypt("Is the terrace open?", conversations.MessageContext(w.company, messageID))
	conversations.InsertCustomerMessage(ctx, w.pool, w.company, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "lena"},
		conversations.IncomingMessage{ID: messageID, BodyEncrypted: body, ChannelMessageID: "a2"})
	draftID, _ := conversations.NewID()
	draft, _ := box.Encrypt("Yes, until 22:00.", conversations.MessageContext(w.company, draftID))
	w.must(`INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status) VALUES ($1, $2, $3, 'out', 'assistant', $4, 'draft')`, draftID, w.company.String(), conversationID, draft)

	code, answer := w.call("GET", "/api/v1/inbox", "", screensSecret, w.cookie)
	rows := answer["rows"].([]any)
	if code != 200 || len(rows) != 1 || answer["counts"].(map[string]any)["needs-you"] != 1.0 || rows[0].(map[string]any)["draftWaiting"] != true {
		t.Fatalf("a waiting reply puts the conversation under Needs you: %d %v", code, answer)
	}
	if rows[0].(map[string]any)["preview"] != "Is the terrace open?" {
		t.Fatalf("the customer hasn't got the waiting reply: it is no preview: %v", rows[0])
	}
	code, page := w.call("GET", "/api/v1/conversations/"+conversationID, "", screensSecret, w.cookie)
	entries := page["entries"].([]any)
	if code != 200 || entries[1].(map[string]any)["text"] != "Is the terrace open?" || page["canReply"] != true || page["replyBlocked"] != "" {
		t.Fatalf("the page, decrypted: %d %v", code, page)
	}
	base := "/api/v1/conversations/" + conversationID
	if code, _ := w.call("POST", base+"/drafts/"+draftID+"/send", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("send the waiting reply: %d", code)
	}
	if row := w.inboxRow(conversationID); row["preview"] != "ansa: Yes, until 22:00." || row["draftWaiting"] != false {
		t.Fatalf("sent, it is the preview: %v", row)
	}
	if code, answer := w.call("POST", base+"/drafts/"+draftID+"/discard", "", screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "already sent") {
		t.Fatalf("it went already: %d %v", code, answer)
	}
	if code, answer := w.call("POST", base+"/reply", `{"text":"   "}`, screensSecret, w.cookie); code != 400 || answer["error"] != "Write a reply first." {
		t.Fatalf("an empty reply: %d %v", code, answer)
	}
	if code, _ := w.call("POST", base+"/reply", `{"text":"See you tonight!\r\nLuigi"}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("a reply: %d", code)
	}
	if files, _ := os.ReadDir(w.outbox); len(files) != 2 {
		t.Fatalf("the waiting reply and the person's reply went out: %d", len(files))
	}
	var handledBy string
	w.pool.QueryRow(ctx, `SELECT handled_by FROM conversations WHERE company_id = $1 AND id = $2`, w.company.String(), conversationID).Scan(&handledBy)
	if handledBy != "person" {
		t.Fatal("replying takes the conversation over")
	}
	if code, _ := w.call("POST", base+"/hand-back", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("hand back")
	}
	if code, _ := w.call("POST", base+"/important", `{"important":true}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("mark important")
	}
	if code, _ := w.call("GET", "/api/v1/conversations/"+strings.Repeat("0", 8)+"-0000-4000-8000-000000000000", "", screensSecret, w.cookie); code != 404 {
		t.Fatal("another company's or no conversation: 404")
	}
	if code, answer := w.call("GET", "/api/v1/activity", "", screensSecret, w.cookie); code != 200 || answer["lines"] == nil {
		t.Fatal("what ansa did")
	}
}

func TestAPersonAnsweringDiscardsAnsasWaitingReply(t *testing.T) {
	w := newAPIWorld(t)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	var conversationID string
	w.pool.QueryRow(context.Background(), `SELECT id FROM conversations WHERE company_id = $1`, w.company.String()).Scan(&conversationID)
	base := "/api/v1/conversations/" + conversationID
	draftID := w.waitingReply(box, conversationID, "Yes, until 22:00.")
	if code, _ := w.call("POST", base+"/reply", `{"text":"It is, see you soon!"}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("a reply: %d", code)
	}
	if status := w.sendStatus(draftID); status != "discarded" {
		t.Fatalf("the person answered: ansa's waiting reply never goes after them: %s", status)
	}
	if code, _ := w.call("POST", base+"/drafts/"+draftID+"/send", "", screensSecret, w.cookie); code != 409 {
		t.Fatalf("it can't be sent any more: %d", code)
	}
	if files, _ := os.ReadDir(w.outbox); len(files) != 1 {
		t.Fatalf("only the person's reply went out: %d", len(files))
	}
	if _, answer := w.call("GET", "/api/v1/inbox", "", screensSecret, w.cookie); answer["counts"].(map[string]any)["needs-you"] != 0.0 {
		t.Fatalf("nothing waits for anyone: %v", answer)
	}

	if code, _ := w.call("POST", base+"/hand-back", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("hand back")
	}
	secondID := w.waitingReply(box, conversationID, "Anything else?")
	if code, _ := w.call("POST", base+"/take-over", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("take over")
	}
	if status := w.sendStatus(secondID); status != "discarded" {
		t.Fatalf("a person took the conversation over: ansa's waiting reply never goes: %s", status)
	}
	var lines int
	w.pool.QueryRow(context.Background(), `SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'draft_discarded' AND actor_user_id IS NOT NULL`, w.company.String()).Scan(&lines)
	if lines != 2 {
		t.Fatalf("each is recorded as a Discard by that person: %d lines", lines)
	}
	if row := w.inboxRow(conversationID); row["preview"] != "You: It is, see you soon!" || row["draftWaiting"] != false {
		t.Fatalf("a discarded reply is no preview: the customer never got it: %v", row)
	}
}

// waitingReply saves a reply of ansa's that waits for a person ("Ask me first").
func (w *apiWorld) waitingReply(box *secure.Box, conversationID, text string) string {
	id, _ := conversations.NewID()
	body, _ := box.Encrypt(text, conversations.MessageContext(w.company, id))
	w.must(`INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status) VALUES ($1, $2, $3, 'out', 'assistant', $4, 'draft')`, id, w.company.String(), conversationID, body)
	return id
}

func (w *apiWorld) sendStatus(messageID string) string {
	var status string
	w.pool.QueryRow(context.Background(), `SELECT send_status FROM messages WHERE company_id = $1 AND id = $2`, w.company.String(), messageID).Scan(&status)
	return status
}

// inboxRow is the conversation's row in the Inbox's "all" view.
func (w *apiWorld) inboxRow(conversationID string) map[string]any {
	_, answer := w.call("GET", "/api/v1/inbox?view=all", "", screensSecret, w.cookie)
	rows, _ := answer["rows"].([]any)
	for _, row := range rows {
		if fields := row.(map[string]any); fields["id"] == conversationID {
			return fields
		}
	}
	w.t.Fatalf("the conversation isn't in the Inbox: %v", answer)
	return nil
}

// An email in a conversation names its request by number, which the page links.
func TestAnEmailInAConversationNamesItsRequest(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	var conversationID, ticketID, emailID string
	w.pool.QueryRow(ctx, `SELECT id FROM conversations WHERE company_id = $1`, w.company.String()).Scan(&conversationID)
	w.pool.QueryRow(ctx, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel, conversation_id) VALUES ($1, 12, 'Table for six', 'd', 'email', $2) RETURNING id`,
		w.company.String(), conversationID).Scan(&ticketID)
	resendID, _ := conversations.NewID()
	w.pool.QueryRow(ctx, `INSERT INTO inbound_emails (company_id, resend_email_id, status, ticket_id, conversation_id) VALUES ($1, $2, 'ticketed', $3, $4) RETURNING id`,
		w.company.String(), "core-test-"+resendID, ticketID, conversationID).Scan(&emailID)
	subject, _ := w.api.Box.Encrypt("Table for six?", "inbound-email-subject:"+w.company.String()+":"+emailID)
	w.must(`UPDATE inbound_emails SET subject_encrypted = $3 WHERE company_id = $1 AND id = $2`, w.company.String(), emailID, subject)
	w.must(`INSERT INTO messages (company_id, conversation_id, direction, author, inbound_email_id) VALUES ($1, $2, 'in', 'customer', $3)`, w.company.String(), conversationID, emailID)

	_, page := w.call("GET", "/api/v1/conversations/"+conversationID, "", screensSecret, w.cookie)
	entries := page["entries"].([]any)
	email, _ := entries[len(entries)-1].(map[string]any)["email"].(map[string]any)
	if email["subject"] != "Table for six?" || email["ticketNumber"] != 12.0 {
		t.Fatalf("the email with its request's number: %v", entries)
	}
}

// "If I haven't answered within N minutes": the page says when ansa answers,
// and in development an owner may let it answer at the scheduler's next round.
func TestTheConversationPageSaysWhenAnsaAnswersAndAnOwnerMayHurryIt(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	var conversationID string
	w.pool.QueryRow(ctx, `SELECT id FROM conversations WHERE company_id = $1`, w.company.String()).Scan(&conversationID)
	base := "/api/v1/conversations/" + conversationID
	if _, page := w.call("GET", base, "", screensSecret, w.cookie); page["assistantDueAt"] != nil || page["canAnswerNow"] != true {
		t.Fatalf("ansa isn't waiting here, and an owner in development may hurry it: %v", page)
	}
	if code, answer := w.call("POST", base+"/answer-now", "", screensSecret, w.cookie); code != 409 || !strings.Contains(fmt.Sprint(answer["error"]), "isn't waiting") {
		t.Fatalf("answering now never starts a wait: %d %v", code, answer)
	}
	w.must(`UPDATE conversations SET assistant_due_at = now() + interval '10 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), conversationID)
	_, page := w.call("GET", base, "", screensSecret, w.cookie)
	due, err := time.Parse(time.RFC3339Nano, fmt.Sprint(page["assistantDueAt"]))
	if err != nil || time.Until(due) < 9*time.Minute {
		t.Fatalf("the page says when ansa answers: %v", page["assistantDueAt"])
	}
	w.call("POST", base+"/take-over", "", screensSecret, w.cookie)
	if _, page := w.call("GET", base, "", screensSecret, w.cookie); page["assistantDueAt"] != nil {
		t.Fatalf("taken over, ansa stays quiet at its time: the page doesn't promise it: %v", page["assistantDueAt"])
	}
	if code, _ := w.call("POST", base+"/answer-now", "", screensSecret, w.cookie); code != 409 {
		t.Fatalf("nor may it be hurried then: %d", code)
	}
	w.call("POST", base+"/hand-back", "", screensSecret, w.cookie)

	member := database.TestOwner(t, w.pool, w.company.String())
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), member)
	token, _ := conversations.NewID()
	w.must(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, member)
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM sessions WHERE token = $1`, token)
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("inbox-changes", member))
	})
	memberCookie := "better-auth.session_token=" + session.SignValue(token, authSecret)
	if _, page := w.call("GET", base, "", screensSecret, memberCookie); page["canAnswerNow"] != false {
		t.Fatal("only owners may hurry ansa")
	}
	if code, _ := w.call("POST", base+"/answer-now", "", screensSecret, memberCookie); code != 403 {
		t.Fatalf("a member can't: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/conversations/00000000-0000-4000-8000-000000000000/answer-now", "", screensSecret, w.cookie); code != 404 {
		t.Fatalf("another company's or no conversation: %d", code)
	}
	if code, _ := w.call("POST", base+"/answer-now", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("answer now: %d", code)
	}
	if w.count(`SELECT count(*) FROM conversations WHERE company_id = $1 AND assistant_due_at <= now()`) != 1 {
		t.Fatal("due now: the catch-up's next round answers it")
	}
	w.api.Development = false
	if _, page := w.call("GET", base, "", screensSecret, w.cookie); page["canAnswerNow"] != false {
		t.Fatal("never offered on a production server")
	}
	if code, _ := w.call("POST", base+"/answer-now", "", screensSecret, w.cookie); code != 403 {
		t.Fatalf("never on a production server: %d", code)
	}
}
