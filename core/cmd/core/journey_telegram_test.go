package main

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeTelegram is Telegram's Bot API as ansa calls it: every sendMessage is
// kept and answered "sent".
type fakeTelegram struct {
	server *httptest.Server
	mu     sync.Mutex
	sent   []telegramMessage
}

type telegramMessage struct {
	ChatID               string `json:"chat_id"`
	Text                 string `json:"text"`
	BusinessConnectionID string `json:"business_connection_id"`
}

func newFakeTelegram(t *testing.T) *fakeTelegram {
	fake := &fakeTelegram{}
	fake.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var message telegramMessage
		json.NewDecoder(r.Body).Decode(&message)
		fake.mu.Lock()
		fake.sent = append(fake.sent, message)
		id := len(fake.sent)
		fake.mu.Unlock()
		fmt.Fprintf(w, `{"ok":true,"result":{"message_id":%d}}`, id)
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

// toCustomer is every text sent into the customer's chat on the business's
// account, oldest first.
func (f *fakeTelegram) toCustomer(chatID, connectionID string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var texts []string
	for _, message := range f.sent {
		if message.ChatID == chatID && message.BusinessConnectionID == connectionID {
			texts = append(texts, message.Text)
		}
	}
	return texts
}

// telegramSide is the Telegram side of the journey: the owner's account,
// its business connection with ansa's bot, and a customer. Random ids, so
// two runs on the shared database never meet.
type telegramSide struct {
	ownerID, customerChatID, connectionID string
	update                                int
}

func newTelegramSide() *telegramSide {
	return &telegramSide{ownerID: fmt.Sprint(100000000 + rand.IntN(800000000)), customerChatID: fmt.Sprint(100000000 + rand.IntN(800000000)),
		connectionID: fmt.Sprintf("journey-%d", rand.Uint64()), update: 100}
}

func (s *telegramSide) next() int {
	s.update++
	return s.update
}

// start is the owner pressing Start in ansa's bot with a link code.
func (s *telegramSide) start(code string) string {
	return fmt.Sprintf(`{"update_id":%d,"message":{"message_id":1,"chat":{"id":%s,"type":"private","first_name":"Rafa"},"from":{"id":%s,"first_name":"Rafa"},"text":"/start %s"}}`,
		s.next(), s.ownerID, s.ownerID, code)
}

// addsTheBot is the owner adding ansa's bot as their account's chatbot.
func (s *telegramSide) addsTheBot() string {
	return fmt.Sprintf(`{"update_id":%d,"business_connection":{"id":"%s","user":{"id":%s,"first_name":"Rafa"},"user_chat_id":%s,"date":1,"is_enabled":true,"rights":{"can_reply":true}}}`,
		s.next(), s.connectionID, s.ownerID, s.ownerID)
}

// customerWrites is the customer writing to the business's account.
func (s *telegramSide) customerWrites(text string) string {
	number := s.next()
	body, _ := json.Marshal(text)
	return fmt.Sprintf(`{"update_id":%d,"business_message":{"message_id":%d,"business_connection_id":"%s","chat":{"id":%s,"type":"private","first_name":"Lena"},"from":{"id":%s,"first_name":"Lena"},"text":%s}}`,
		number, number, s.connectionID, s.customerChatID, s.customerChatID, body)
}

// codeIn is the link code of the "https://t.me/<bot>?start=<code>" link.
func codeIn(t *testing.T, link any) string {
	text, _ := link.(string)
	_, code, found := strings.Cut(text, "?start=")
	if !found {
		t.Fatalf("not a link with a code: %v", link)
	}
	return code
}
