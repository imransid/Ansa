package phone

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/assistant"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/chat"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// callWorld is one test company with a fake brain that answers
// `brainAnswer` (never the real model), and the phone service.
type callWorld struct {
	t           *testing.T
	pool        *database.Pool
	companyID   string
	company     tenant.CompanyID
	phone       *Service
	limiter     *ratelimit.Limiter
	brainCalls  int
	channels    []string
	modes       []string
	lastBody    string
	brainAnswer string
	// Runs while the brain "thinks" (before it answers), when set.
	whileThinking func()
}

func newCallWorld(t *testing.T, brainAnswer string) *callWorld {
	pool := database.ForTest(t)
	w := &callWorld{t: t, pool: pool, brainAnswer: brainAnswer}
	w.companyID = database.TestCompany(t, pool)
	w.company, _ = tenant.FromTrustedSource(w.companyID)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.brainCalls++
		var request struct {
			Channel  string `json:"channel"`
			CallMode string `json:"call_mode"`
		}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &request)
		w.channels = append(w.channels, request.Channel)
		w.modes = append(w.modes, request.CallMode)
		w.lastBody = string(body)
		if w.whileThinking != nil {
			w.whileThinking()
		}
		rw.Header().Set("Content-Type", "application/json")
		io.WriteString(rw, w.brainAnswer)
	}))
	t.Cleanup(brain.Close)
	limiter := ratelimit.New(pool, "core-test-secret")
	w.limiter = limiter
	runner := &assistant.Runner{Pool: pool, Box: box, Limiter: limiter, Log: logging.New(io.Discard),
		Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Chat: &chat.Sender{}}
	w.phone = &Service{Pool: pool, Box: box, Assistant: runner, Log: logging.New(io.Discard)}
	w.exec(`UPDATE companies SET name = 'Luigi''s' WHERE id = $1`, w.companyID)
	w.exec(`INSERT INTO catalog_items (company_id, category, name, price_cents, position) VALUES ($1, 'Pizza', 'Margherita', 950, 1)`, w.companyID)
	t.Cleanup(func() {
		ctx := context.Background()
		pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("assistant-replies", w.companyID))
		rows, _ := pool.Query(ctx, `SELECT id FROM conversations WHERE company_id = $1`, w.companyID)
		for rows.Next() {
			var id string
			rows.Scan(&id)
			pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = ANY($1)`, []string{limiter.Key("assistant-customer", id), limiter.Key("assistant-call", id)})
		}
		rows.Close()
	})
	return w
}

func (w *callWorld) exec(statement string, args ...any) {
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

func (w *callWorld) count(statement string, args ...any) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, args...).Scan(&n); err != nil {
		w.t.Fatalf("count: %v", err)
	}
	return n
}

func (w *callWorld) start() Started {
	started, err := w.phone.Start(context.Background(), w.company, Caller{Line: LinePractice, Number: "+39 333 123 4567", Name: "Lena"})
	if err != nil {
		w.t.Fatalf("Start: %v", err)
	}
	return started
}

func (w *callWorld) say(callID, words string) []string {
	answer, err := w.phone.Turn(context.Background(), w.company, callID, words)
	if err != nil {
		w.t.Fatalf("Turn: %v", err)
	}
	return answer
}

func TestACallIsAnsweredWithTheSameBrainAsAChat(t *testing.T) {
	w := newCallWorld(t, `{"kind":"reply","text":"Yes, we're open until 23:00."}`)
	call := w.start()
	if len(call.Words) != 1 || call.Words[0] != "Hello! I'm the AI assistant for Luigi's. How can I help you?" {
		t.Fatalf("greeting: %q", call.Words)
	}
	if w.count(`SELECT count(*) FROM contacts WHERE company_id = $1 AND channel = 'phone' AND external_id = '393331234567' AND display_name = 'Lena'`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM phone_calls WHERE company_id = $1 AND id = $2 AND ended_at IS NULL AND line = 'practice'`, w.companyID, call.CallID) != 1 {
		t.Fatal("the caller's phone conversation and a live call")
	}
	words := w.say(call.CallID, "Are you open tonight?")
	if len(words) != 1 || words[0] != "Yes, we're open until 23:00." {
		t.Fatalf("the AI's checked answer, no second AI label (the greeting said it): %q", words)
	}
	if w.channels[len(w.channels)-1] != "call" {
		t.Fatal("the brain is told it is a call (spoken words)")
	}
	// "Ask me first" never makes a caller wait for an approval.
	w.exec(`INSERT INTO assistant_settings (company_id, reply_mode) VALUES ($1, 'ask_first')`, w.companyID)
	if words := w.say(call.CallID, "And tomorrow?"); len(words) != 1 {
		t.Fatalf("answered at once: %q", words)
	}
	if w.count(`SELECT count(*) FROM messages WHERE company_id = $1 AND send_status = 'draft'`, w.companyID) != 0 ||
		w.count(`SELECT count(*) FROM messages WHERE company_id = $1 AND direction = 'in'`, w.companyID) != 2 ||
		w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'replied'`, w.companyID) != 2 {
		t.Fatal("the caller's words and ansa's are the conversation; ansa's lines for While you were away")
	}
	// Nobody else can send into a phone conversation (a person's reply, an order's status).
	err := database.InTx(context.Background(), w.pool, func(tx database.Tx) error {
		_, refusal, err := chat.RouteWithin(context.Background(), tx, w.company, call.ConversationID)
		if err == nil && refusal != chat.RefusedNotChat {
			t.Errorf("a phone conversation is no chat: %q", refusal)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.phone.End(context.Background(), w.company, call.CallID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.phone.Turn(context.Background(), w.company, call.CallID, "Hello?"); !errors.Is(err, ErrCallOver) {
		t.Fatalf("an ended call takes no more words: %v", err)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`, w.companyID) != 0 {
		t.Fatal("a call ansa answered needs nobody")
	}
}

func TestAnOrderIsTakenOnTheCallInSpokenWords(t *testing.T) {
	w := newCallWorld(t, `{"kind":"order_summary","order":{"items":[{"label":"M1","quantity":2}],"fulfilment":"pickup","address":"","time":"20:00","notes":""}}`)
	w.exec(`INSERT INTO assistant_settings (company_id, pickup) VALUES ($1, true)`, w.companyID)
	call := w.start()
	words := w.say(call.CallID, "Two Margherita for pickup at eight please")
	if len(words) != 1 || words[0] != "Here is your order: 2 Margherita, 19 euros. Total, 19 euros. For pickup. When: 20:00. Shall I place the order? Please say yes to confirm." {
		t.Fatalf("ansa's own spoken summary: %q", words)
	}
	w.brainAnswer = `{"kind":"order_confirmed"}`
	if words := w.say(call.CallID, "Yes"); len(words) != 1 || words[0] != "Thank you! Your order number 1 is placed." {
		t.Fatalf("placed, promising no message later: %q", words)
	}
	if w.count(`SELECT count(*) FROM orders WHERE company_id = $1 AND status = 'new' AND total_cents = 1900`, w.companyID) != 1 {
		t.Fatal("the order is on the Orders page with ansa's total")
	}
}

func TestAPersonsCallSaysWhoseAssistantItIs(t *testing.T) {
	w := newCallWorld(t, `{"kind":"reply","text":"x"}`)
	w.exec(`UPDATE companies SET kind = 'personal', name = 'Rafa' WHERE id = $1`, w.companyID)
	call := w.start()
	if call.Words[0] != "Hello! I'm Rafa's AI assistant. Rafa can't take your call right now. How can I help?" {
		t.Fatalf("never pretends to be them: %q", call.Words)
	}
	if _, err := w.phone.Start(context.Background(), w.company, Caller{Line: LinePractice, Number: "12"}); !errors.Is(err, ErrBadNumber) {
		t.Fatalf("a number too short to tell callers apart: %v", err)
	}
	if _, err := w.phone.Turn(context.Background(), w.company, "not-an-id", "hi"); !errors.Is(err, ErrCallOver) {
		t.Fatalf("an unknown call: %v", err)
	}
	again := w.start()
	if w.count(`SELECT count(*) FROM phone_calls WHERE company_id = $1 AND ended_at IS NULL`, w.companyID) != 1 || again.CallID == call.CallID {
		t.Fatal("a new call ends the one left live in the same conversation")
	}
}
