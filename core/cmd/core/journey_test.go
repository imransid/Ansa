package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// One business from signup to its first order and post, through core as
// the server runs it (step 58): sign up and confirm, set up, connect
// Telegram, a customer's question answered, an order priced by ansa,
// confirmed, accepted, sent and done, and a "Post for me" post published on
// the business's Facebook Page. A second business then finds none of it.
// The AI is a fake brain and Telegram a fake API: what is proved is core.
func TestOneBusinessFromSignupToItsFirstOrderAndPost(t *testing.T) {
	j := newJourney(t)
	pizzeria := j.signUp("Lena Rossi")
	j.setUpPizzeria(pizzeria)
	side := newTelegramSide()
	j.connectTelegram(pizzeria, side)

	// A question: ansa answers as the business's AI assistant.
	j.brain.willReply(`{"kind":"reply","text":"Yes, we're open until midnight."}`)
	answer := j.customerWrites(pizzeria, side, "Are you open tonight?")
	if !strings.Contains(answer, "AI assistant") || !strings.Contains(answer, "Yes, we're open until midnight.") {
		t.Fatalf("the answer, with the AI label first: %q", answer)
	}

	// An order: the AI names the dish by its menu label, ansa prices it and
	// asks the customer to confirm; their yes places it.
	j.brain.willReply(`{"kind":"order_summary","order":{"items":[{"label":"M1","quantity":2}],"fulfilment":"delivery","address":"Via Verdi 3","time":"","notes":""}}`)
	summary := j.customerWrites(pizzeria, side, "Two margheritas to Via Verdi 3, please")
	if !strings.Contains(summary, "Margherita") || !strings.Contains(summary, "21.50") || !strings.Contains(strings.ToLower(summary), "yes") {
		t.Fatalf("ansa's own summary: 2 x 9.50 + 2.50 delivery = 21.50, and a yes asked for: %q", summary)
	}
	j.brain.willReply(`{"kind":"order_confirmed"}`)
	if placed := j.customerWrites(pizzeria, side, "Yes"); !strings.Contains(placed, "#1") {
		t.Fatalf("the order placed as #1: %q", placed)
	}
	open := j.openOrders(pizzeria)
	if len(open) != 1 || open[0]["status"] != "new" || open[0]["totalCents"] != 2150.0 || open[0]["address"] != "Via Verdi 3" {
		t.Fatalf("the Orders page: %v", open)
	}
	order := open[0]["id"].(string)
	for _, change := range []string{"accept", "ready", "done"} {
		j.mustSave(pizzeria, "/api/v1/orders/"+order+"/status", `{"change":"`+change+`"}`)
	}
	if told := j.telegram.toCustomer(side.customerChatID, side.connectionID); len(told) != 6 {
		t.Fatalf("the customer is told each step (answer, summary, placed, accepted, on its way, done): %q", told)
	}
	if len(j.openOrders(pizzeria)) != 0 {
		t.Fatal("a done order leaves To do")
	}

	// "Post for me": the Page connected, the switch on, a post written now
	// and sent by the queue's next round.
	j.mustSave(pizzeria, "/api/v1/social/facebook/stand-in", `{}`)
	j.mustSave(pizzeria, "/api/v1/settings/posts", `{"enabled":true,"frequency":"three_a_week","time":"11:00","mode":"automatic","understood":true}`)
	j.brain.willPost(`{"kind":"ok","body":"Fresh Margherita from our wood oven tonight.","call_to_action":"Write to us on Telegram","hashtags":["pizza"]}`)
	j.mustSave(pizzeria, "/api/v1/settings/posts/now", `{}`)
	if _, err := j.core.publisher.RunDue(context.Background(), pizzeria.companyID); err != nil {
		t.Fatalf("the queue's round: %v", err)
	}
	posted, _ := filepath.Glob(filepath.Join(j.dev, ".dev-social", "facebook", "*"))
	if len(posted) != 1 {
		t.Fatalf("one post on the stand-in Page: %v", posted)
	}
	if page, _ := os.ReadFile(posted[0]); !strings.Contains(string(page), "Fresh Margherita from our wood oven tonight.") {
		t.Fatalf("the post as the AI wrote it: %s", page)
	}

	j.secondBusinessSeesNone(pizzeria, side, order)
}

// secondBusinessSeesNone: another business, signed up the same way, finds
// none of the first one's conversations, orders, menu or posts, and can't
// take its Telegram account.
func (j *journey) secondBusinessSeesNone(first owner, side *telegramSide, order string) {
	salon := j.signUp("Mia Bianchi")
	_, inbox := j.call("GET", "/api/v1/inbox?view=all", "", first.cookie)
	rows, _ := inbox["rows"].([]any)
	if len(rows) != 1 {
		j.t.Fatalf("the first business's conversation: %v", inbox)
	}
	conversation := rows[0].(map[string]any)["id"].(string)
	if _, theirs := j.call("GET", "/api/v1/inbox?view=all", "", salon.cookie); len(theirs["rows"].([]any)) != 0 {
		j.t.Fatalf("the second business sees a conversation: %v", theirs)
	}
	refused := []struct{ method, path, body string }{
		{"GET", "/api/v1/conversations/" + conversation, ""},
		{"POST", "/api/v1/orders/" + order + "/status", `{"change":"cancel"}`},
		{"POST", "/api/v1/conversations/" + conversation + "/reply", `{"text":"Hello from another business"}`},
	}
	for _, request := range refused {
		if code, answer := j.call(request.method, request.path, request.body, salon.cookie); code != 404 {
			j.t.Fatalf("%s %s by another business: %d %v", request.method, request.path, code, answer)
		}
	}
	if len(j.openOrders(salon)) != 0 {
		j.t.Fatal("the second business sees an order")
	}
	for _, page := range []string{"/api/v1/menu", "/api/v1/settings/posts", "/api/v1/home"} {
		if code, answer := j.call("GET", page, "", salon.cookie); code != 200 || strings.Contains(asText(answer), "Margherita") || strings.Contains(asText(answer), "Lena") {
			j.t.Fatalf("%s of the second business: %d %v", page, code, answer)
		}
	}
	// The pizzeria's Telegram account, offered to the salon with the salon's
	// own code, stays the pizzeria's.
	answer := j.mustSave(salon, "/api/v1/channels/telegram/link", `{}`)
	j.telegramSends(side.start(codeIn(j.t, answer["link"])))
	j.telegramSends(side.addsTheBot())
	var holder string
	j.pool.QueryRow(context.Background(), `SELECT company_id::text FROM channel_connections WHERE external_id = $1 AND status <> 'disconnected'`, side.connectionID).Scan(&holder)
	if holder != first.companyID {
		j.t.Fatalf("the Telegram account moved to another business")
	}
}

// asText is an answer as one string, to look for a word anywhere in it.
func asText(answer map[string]any) string {
	text, _ := json.Marshal(answer)
	return string(text)
}
