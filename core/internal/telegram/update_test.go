package telegram

import "testing"

func TestABusinessMessageIsReadWithOnlyWhatAnsaUses(t *testing.T) {
	body := []byte(`{"update_id":7,"business_message":{"message_id":42,"business_connection_id":"bc-1",
		"chat":{"id":555,"type":"private","first_name":"Lena","last_name":"Moretti"},
		"from":{"id":555,"first_name":"Lena"},"caption":"Is this vegan?","photo":[{"file_id":"x"}],"extra":true}}`)
	update, err := ParseUpdate(body)
	if err != nil || update.BusinessMessage == nil {
		t.Fatalf("parse: %v", err)
	}
	message := update.BusinessMessage
	if message.MessageID != "42" || message.Chat.ID != "555" || message.BusinessConnectionID != "bc-1" || message.MediaKind != "photo" || message.SentByBot {
		t.Fatalf("got %+v", message)
	}
	if message.Describe() != "[A photo: open Telegram to see it]\nIs this vegan?" {
		t.Fatalf("describe: %q", message.Describe())
	}
	if DisplayName(message.Chat.FirstName, message.Chat.LastName, "") != "Lena Moretti" || DisplayName("", "", "lena") != "@lena" {
		t.Fatal("display names")
	}
}

func TestUnreadableOrUnsafeUpdatesAreRefused(t *testing.T) {
	for _, body := range []string{
		`not json`,
		`{"business_message":{"message_id":1,"chat":{"id":1,"type":"private"}}}`,
		`{"update_id":1,"business_message":{"message_id":1,"chat":{"id":9007199254740993,"type":"private"}}}`,
		`{"update_id":1,"business_message":{"message_id":1.5,"chat":{"id":1,"type":"private"}}}`,
	} {
		if _, err := ParseUpdate([]byte(body)); err != ErrNotAnUpdate {
			t.Fatalf("%s: expected ErrNotAnUpdate, got %v", body, err)
		}
	}
}

func TestTheBotsOwnReplyComingBackIsMarked(t *testing.T) {
	update, err := ParseUpdate([]byte(`{"update_id":1,"business_message":{"message_id":2,"chat":{"id":3,"type":"private"},"text":"hi","sender_business_bot":{"id":9}}}`))
	if err != nil || !update.BusinessMessage.SentByBot {
		t.Fatalf("got %+v %v", update, err)
	}
}
