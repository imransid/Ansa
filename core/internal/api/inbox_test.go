package api

import (
	"context"
	"os"
	"strings"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/secure"
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
