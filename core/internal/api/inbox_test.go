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
	if code != 200 || len(rows) != 1 || answer["counts"].(map[string]any)["needs-you"] != 1.0 || rows[0].(map[string]any)["preview"] != "ansa: Yes, until 22:00." {
		t.Fatalf("a waiting reply puts the conversation under Needs you: %d %v", code, answer)
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
