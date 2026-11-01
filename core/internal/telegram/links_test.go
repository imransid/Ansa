package telegram

import (
	"context"
	"fmt"
	"io"
	"math/rand/v2"
	"strings"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// linkWorld is a company with an owner and a fresh link code, a Telegram
// user (random ids, so the shared local database never clashes), and the
// bot's notes caught instead of sent.
type linkWorld struct {
	*fixture
	companyID, owner, code, userID, connectionID string
	notes                                        []string
}

func newLinkWorld(t *testing.T) *linkWorld {
	pool := database.ForTest(t)
	w := &linkWorld{fixture: &fixture{pool: pool}}
	w.companyID = database.TestCompany(t, pool)
	w.company, _ = tenant.FromTrustedSource(w.companyID)
	w.owner = database.TestOwner(t, pool, w.companyID)
	w.code = strings.Repeat("A", 11) + fmt.Sprintf("%032d", rand.Uint64())
	w.userID = fmt.Sprint(100000000 + rand.IntN(800000000))
	w.connectionID, _ = conversations.NewID()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO telegram_link_codes (company_id, created_by_user_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')`, w.companyID, w.owner, HashLinkCode(w.code)); err != nil {
		t.Fatalf("setup: %v", err)
	}
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	limiter := ratelimit.New(pool, strings.Repeat("r", 40))
	w.webhook = &Webhook{Pool: pool, Limiter: limiter, Box: box, Log: logging.New(io.Discard), Secret: testSecret,
		Notify: func(_, text string) { w.notes = append(w.notes, text) }}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM telegram_pending_connections WHERE external_id = $1`, w.connectionID)
		pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("telegram-bot-chat", w.userID))
	})
	return w
}

func (w *linkWorld) start(code string) int {
	return w.post(testSecret, `{"update_id":2,"message":{"message_id":1,"chat":{"id":`+w.userID+`,"type":"private","first_name":"Luigi"},"from":{"id":`+w.userID+`,"first_name":"Luigi"},"text":"/start `+code+`"}}`)
}

func (w *linkWorld) chatbotAdded(canReply bool) int {
	return w.post(testSecret, fmt.Sprintf(`{"update_id":3,"business_connection":{"id":"%s","user":{"id":%s,"first_name":"Luigi's"},"user_chat_id":%s,"date":1,"is_enabled":true,"rights":{"can_reply":%t}}}`, w.connectionID, w.userID, w.userID, canReply))
}

func (w *linkWorld) lastNote() string {
	if len(w.notes) == 0 {
		return ""
	}
	return w.notes[len(w.notes)-1]
}

func TestStartThenChatbotConnectsTheCodesCompany(t *testing.T) {
	w := newLinkWorld(t)
	if w.start(w.code) != 200 || w.lastNote() != botNotes.WaitingForChatbot {
		t.Fatalf("after the Start the bot asks to be added: %q", w.lastNote())
	}
	if w.chatbotAdded(true) != 200 || w.lastNote() != botNotes.Connected {
		t.Fatalf("connected: %q", w.lastNote())
	}
	if w.count(t, `SELECT count(*) FROM channel_connections WHERE company_id = $1 AND status = 'connected' AND display_name = 'Luigi''s'`) != 1 {
		t.Fatal("the account is tied to the code's company")
	}
	if w.start(w.code); w.lastNote() != botNotes.LinkExpired {
		t.Fatal("a code works once")
	}
	w.post(testSecret, fmt.Sprintf(`{"update_id":4,"business_connection":{"id":"%s","user":{"id":%s},"user_chat_id":%s,"date":1,"is_enabled":false}}`, w.connectionID, w.userID, w.userID))
	if w.count(t, `SELECT count(*) FROM channel_connections WHERE company_id = $1 AND status = 'removed_in_telegram'`) != 1 {
		t.Fatal("removing the bot in Telegram is recorded")
	}
}

func TestAChatbotAddedFirstWaitsForTheStart(t *testing.T) {
	w := newLinkWorld(t)
	if w.chatbotAdded(false) != 200 || w.lastNote() != botNotes.NeedsLink {
		t.Fatalf("a chatbot nobody named waits: %q", w.lastNote())
	}
	if w.count(t, `SELECT count(*) FROM channel_connections WHERE company_id = $1`) != 0 {
		t.Fatal("nothing is tied before a code names the company")
	}
	if w.start(w.code); w.lastNote() != botNotes.ConnectedCannotReply {
		t.Fatalf("the Start ties the waiting chatbot: %q", w.lastNote())
	}
}

func TestOnlyAnActiveOwnersCodeConnectsAndOnlyOnce(t *testing.T) {
	w := newLinkWorld(t)
	w.post(testSecret, `{"update_id":5,"message":{"message_id":1,"chat":{"id":`+w.userID+`,"type":"private"},"from":{"id":`+w.userID+`},"text":"hello"}}`)
	if w.lastNote() != botNotes.NeedsLink {
		t.Fatal("anyone else is told how to connect")
	}
	if w.start(strings.Repeat("B", 43)); w.lastNote() != botNotes.LinkExpired {
		t.Fatal("a made-up code connects nothing")
	}
	w.start(w.code)
	if _, err := w.pool.Exec(context.Background(), `UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.companyID, w.owner); err != nil {
		t.Fatalf("setup: %v", err)
	}
	w.chatbotAdded(true)
	if w.count(t, `SELECT count(*) FROM channel_connections WHERE company_id = $1`) != 0 {
		t.Fatal("an owner made a member meanwhile connects nothing")
	}
}
