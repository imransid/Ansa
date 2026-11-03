package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"time"

	"ansa/core/internal/assistant"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/chat"
	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/inbox"
	"ansa/core/internal/logging"
	"ansa/core/internal/orders"
	"ansa/core/internal/practicechat"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// The demo's history (pnpm demo:reset): conversations that already
// happened, so the Inbox, Orders, requests and Home look lived-in from the
// start. Every message goes through the real assistant (its checks, orders
// priced by ansa, handovers, routing, owner alerts) with a scripted brain
// answering it, so the history is the same every time and asks no AI. A
// running core sends the alerts it leaves (the development mailbox).

// demoChat is one customer's conversation.
type demoChat struct {
	channel, name string
	// Marked important first: ansa then passes them straight on, no AI.
	important bool
	turns     []demoTurn
}

// demoTurn is one message of the customer's, and the brain's answer to it
// (as the real brain sends one; "" when no brain is asked).
type demoTurn struct {
	customer, brain string
}

// playDemoChats runs each conversation through the assistant; it returns
// each customer's conversation by name.
func playDemoChats(ctx context.Context, w *world, a demoAccount, chats []demoChat) (map[string]string, error) {
	brain := newScriptedBrain()
	defer brain.server.Close()
	runner := &assistant.Runner{Pool: w.pool, Box: w.box, Limiter: ratelimit.New(w.pool, w.cfg.AuthSecret), Log: logging.New(io.Discard),
		Chat:  &chat.Sender{StandInsAllowed: true, StandInDir: filepath.Join(w.cfg.DevFolder, ".dev-messages")},
		Brain: brainclient.New(brain.server.URL, w.cfg.BrainSharedSecret, 30*time.Second), Now: lunchtimeInDhaka}
	conversationOf := map[string]string{}
	for _, c := range chats {
		for i, t := range c.turns {
			turn, err := practicechat.Send(ctx, w.pool, w.box, a.company, c.channel, c.name, t.customer)
			if err != nil {
				return nil, err
			}
			conversationOf[c.name] = turn.ConversationID
			// The running core would answer it with the real AI: this one is
			// scripted (its reply job waits 1.5 s, so it is never claimed).
			if err := dropReplyJobs(ctx, w, a.company); err != nil {
				return nil, err
			}
			if c.important && i == 0 {
				if _, err := inbox.SetImportant(ctx, w.pool, a.company, a.userID, turn.ConversationID, true); err != nil {
					return nil, err
				}
			}
			brain.next(t.brain)
			if _, err := runner.Answer(ctx, *turn, false); err != nil {
				return nil, err
			}
		}
	}
	return conversationOf, nil
}

// lunchtimeInDhaka is the history's clock: today at 13:00 in the demo's
// time zone, when the restaurant is open, so a reset at night still places
// its orders (only the opening hours read this clock).
func lunchtimeInDhaka() time.Time {
	dhaka, err := time.LoadLocation("Asia/Dhaka")
	if err != nil {
		return time.Now()
	}
	now := time.Now().In(dhaka)
	return time.Date(now.Year(), now.Month(), now.Day(), 13, 0, 0, 0, dhaka)
}

func dropReplyJobs(ctx context.Context, w *world, company tenant.CompanyID) error {
	_, err := w.pool.Exec(ctx, `DELETE FROM core_jobs WHERE company_id = $1 AND kind = $2 AND status = 'queued'`, company.String(), conversations.ReplyJobKind)
	return err
}

// scriptedBrain answers the assistant with the next scripted answer.
type scriptedBrain struct {
	server *httptest.Server
	mu     sync.Mutex
	answer string
}

func newScriptedBrain() *scriptedBrain {
	brain := &scriptedBrain{}
	brain.server = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		brain.mu.Lock()
		defer brain.mu.Unlock()
		if brain.answer == "" {
			rw.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		io.WriteString(rw, brain.answer)
	}))
	return brain
}

func (b *scriptedBrain) next(answer string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.answer = answer
}

// The brain's answers, as it sends them to core.

func reply(text string) string {
	return marshal(map[string]any{"kind": "reply", "text": text})
}

func needsPerson(reason, subject, summary, category string) string {
	return marshal(map[string]any{"kind": "needs_person", "reason": reason, "subject": subject, "summary": summary, "category": category, "text": ""})
}

// orderSummary names each dish by its menu label (M1...) with how many.
func orderSummary(fulfilment, address, when string, items ...any) string {
	var lines []map[string]any
	for i := 0; i+1 < len(items); i += 2 {
		lines = append(lines, map[string]any{"label": items[i], "quantity": items[i+1]})
	}
	order := map[string]any{"items": lines, "fulfilment": fulfilment, "address": address, "time": when, "notes": ""}
	return marshal(map[string]any{"kind": "order_summary", "order": order})
}

const orderConfirmed = `{"kind":"order_confirmed"}`

func marshal(value any) string {
	text, _ := json.Marshal(value)
	return string(text)
}

// finishDemoOrder takes the customer's placed order through every step to
// done, as the Orders page's buttons do (the customer told each time).
func finishDemoOrder(ctx context.Context, w *world, a demoAccount, conversationID string) error {
	var orderID string
	err := w.pool.QueryRow(ctx, `SELECT id::text FROM orders WHERE company_id = $1 AND conversation_id = $2 AND status = 'new'`, a.company.String(), conversationID).Scan(&orderID)
	if err != nil {
		return err
	}
	changer := &orders.StatusChange{Pool: w.pool, Box: w.box, Sender: &chat.Sender{StandInsAllowed: true, StandInDir: filepath.Join(w.cfg.DevFolder, ".dev-messages")}}
	for _, change := range []string{"accept", "ready", "done"} {
		result, err := changer.Change(ctx, a.company, a.userID, orderID, change)
		if err != nil {
			return err
		}
		if result.Outcome != orders.ChangeDone {
			return commands.Refusal("The demo's order couldn't be moved on (" + result.Outcome + ").")
		}
	}
	return nil
}
