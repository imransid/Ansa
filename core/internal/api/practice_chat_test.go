package api

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
	"ansa/core/internal/whatsapp"
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

// "Answer as the business, from its own app": the text is saved as the
// business's own message through each channel's own path (Telegram's
// update handling, the WhatsApp Business app's echo, the Page's own
// message), in the made-up customer's conversation, and the chat shows it
// on the business's side. ansa steps back as for a real one (it answers
// always here: the conversation is taken over, until Hand back). The
// customer writes first.
func TestThePracticeChatAnswersAsTheBusinessFromItsOwnApp(t *testing.T) {
	w := newAPIWorld(t)
	w.serverAPI().WhatsApp = &whatsapp.Connector{Pool: w.pool, Box: w.api.Box, Development: true}
	for _, standIn := range []string{"/api/v1/channels/telegram/stand-in", "/api/v1/channels/whatsapp/stand-in", "/api/v1/social/facebook/stand-in"} {
		if code, _ := w.call("POST", standIn, "", screensSecret, w.cookie); code != 200 {
			t.Fatalf("%s: %d", standIn, code)
		}
	}
	for _, channel := range []string{"telegram", "whatsapp", "messenger"} {
		answer := `{"channel":"` + channel + `","name":"Nadia","text":"On my way!","asBusiness":true}`
		if code, _ := w.call("POST", "/api/v1/practice/chat", answer, screensSecret, w.cookie); code != 409 {
			t.Fatalf("%s: the customer writes first: %d", channel, code)
		}
		_, asked := w.call("POST", "/api/v1/practice/chat", `{"channel":"`+channel+`","name":"Nadia","text":"Is my order coming?"}`, screensSecret, w.cookie)
		conversation, _ := asked["conversationId"].(string)
		if code, answered := w.call("POST", "/api/v1/practice/chat", answer, screensSecret, w.cookie); code != 200 || answered["conversationId"] != conversation {
			t.Fatalf("%s: answered: %d %v", channel, code, answered)
		}
		_, chat := w.call("GET", "/api/v1/practice/chat/"+conversation, "", screensSecret, w.cookie)
		lines, _ := chat["lines"].([]any)
		if len(lines) != 2 || lines[1].(map[string]any)["text"] != "On my way!" || lines[1].(map[string]any)["fromCustomer"] != false {
			t.Fatalf("%s: on the business's side of the chat: %v", channel, chat)
		}
		inConversation := ` AND conversation_id = '` + conversation + `'`
		if w.count(`SELECT count(*) FROM messages WHERE company_id = $1 AND author = 'business_account'`+inConversation) != 1 ||
			w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'taken_over' AND actor_user_id IS NULL`+inConversation) != 1 {
			t.Fatalf("%s: saved as the business's own message, and ansa stepped back", channel)
		}
		if code, _ := w.call("POST", "/api/v1/conversations/"+conversation+"/hand-back", "", screensSecret, w.cookie); code != 200 ||
			w.count(`SELECT count(*) FROM conversations WHERE company_id = $1 AND handled_by = 'assistant' AND id = '`+conversation+`'`) != 1 {
			t.Fatalf("%s: Hand back to ansa gives it back", channel)
		}
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
