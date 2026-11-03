package api

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// The practice chat (step 58): an owner writes as a made-up customer
// through a stand-in account; the message joins that customer's
// conversation with the assistant's reply queued, and the chat shows what
// reached the customer (never a reply waiting for approval). Development and
// owners only; another company's chat isn't there.
func TestThePracticeChatWritesAsACustomerThroughAStandIn(t *testing.T) {
	w := newAPIWorld(t)
	if code, answer := w.call("GET", "/api/v1/practice/chat", "", screensSecret, w.cookie); code != 200 || answer["available"] != true || answer["standIns"].(map[string]any)["telegram"] != false {
		t.Fatalf("the page: %d %v", code, answer)
	}
	lena := `{"channel":"telegram","name":"Lena Rossi","text":"Are you open tonight?"}`
	if code, _ := w.call("POST", "/api/v1/practice/chat", lena, screensSecret, w.cookie); code != 409 {
		t.Fatalf("no stand-in Telegram account yet: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/channels/telegram/stand-in", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("stand-in: %d", code)
	}
	replyJobs := `SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'assistant.reply'`
	before := w.count(replyJobs)
	code, answer := w.call("POST", "/api/v1/practice/chat", lena, screensSecret, w.cookie)
	conversation, _ := answer["conversationId"].(string)
	if code != 200 || conversation == "" {
		t.Fatalf("sent: %d %v", code, answer)
	}
	if w.count(replyJobs) != before+1 {
		t.Fatal("the assistant's reply is queued, as for any customer")
	}
	_, again := w.call("POST", "/api/v1/practice/chat", `{"channel":"telegram","name":" lena rossi ","text":"And tomorrow?"}`, screensSecret, w.cookie)
	if again["conversationId"] != conversation {
		t.Fatal("the same name is the same customer")
	}

	if _, found := w.call("GET", "/api/v1/practice/chat/find?channel=telegram&name=Lena%20Rossi", "", screensSecret, w.cookie); found["conversationId"] != conversation {
		t.Fatalf("found again after a reload: %v", found)
	}
	if _, found := w.call("GET", "/api/v1/practice/chat/find?channel=telegram&name=Marco", "", screensSecret, w.cookie); found["conversationId"] != "" {
		t.Fatalf("a customer who never wrote: %v", found)
	}
	w.addReply(conversation, "draft", "A reply waiting for the owner")
	w.addReply(conversation, "sent", "Yes, until 23:00.")
	_, chat := w.call("GET", "/api/v1/practice/chat/"+conversation, "", screensSecret, w.cookie)
	lines, _ := chat["lines"].([]any)
	if len(lines) != 3 || lines[0].(map[string]any)["text"] != "Are you open tonight?" || lines[0].(map[string]any)["fromCustomer"] != true ||
		lines[2].(map[string]any)["text"] != "Yes, until 23:00." || lines[2].(map[string]any)["fromCustomer"] != false {
		t.Fatalf("what the customer sees, never the draft: %v", chat)
	}

	if code, _ := w.call("POST", "/api/v1/practice/chat", `{"channel":"sms","name":"","text":""}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("checked fields: %d", code)
	}
	if code, _ := w.call("GET", "/api/v1/practice/chat/"+anotherCompanysConversation(t, w), "", screensSecret, w.cookie); code != 404 {
		t.Fatalf("another company's chat: %d", code)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/practice/chat", lena, screensSecret, w.cookie); code != 403 {
		t.Fatalf("members: %d", code)
	}
	w.must(`UPDATE users SET role = 'owner' WHERE company_id = $1`, w.company.String())
	w.api.Development = false
	if code, _ := w.call("POST", "/api/v1/practice/chat", lena, screensSecret, w.cookie); code != 403 {
		t.Fatalf("production: %d", code)
	}
}

// addReply saves one reply of the assistant in the conversation, in the
// send status given.
func (w *apiWorld) addReply(conversationID, status, text string) {
	id, _ := conversations.NewID()
	body, _ := w.api.Box.Encrypt(text, conversations.MessageContext(w.company, id))
	w.must(`INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status) VALUES ($1, $2, $3, 'out', 'assistant', $4, $5)`,
		id, w.company.String(), conversationID, body, status)
}

func anotherCompanysConversation(t *testing.T, w *apiWorld) string {
	other, _ := tenant.FromTrustedSource(database.TestCompany(t, w.pool))
	id, _ := conversations.NewID()
	turn, err := conversations.InsertCustomerMessage(context.Background(), w.pool, other, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "marco"},
		conversations.IncomingMessage{ID: id, BodyEncrypted: "v1:x:y:z", ChannelMessageID: "m1"})
	if err != nil {
		t.Fatal(err)
	}
	return turn.ConversationID
}
