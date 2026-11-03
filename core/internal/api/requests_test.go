package api

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"ansa/core/internal/database"
)

func TestRequestsThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	var conversationID, owner string
	w.pool.QueryRow(ctx, `SELECT id FROM conversations WHERE company_id = $1`, w.company.String()).Scan(&conversationID)
	w.pool.QueryRow(ctx, `SELECT id FROM users WHERE company_id = $1`, w.company.String()).Scan(&owner)
	expert := database.TestOwner(t, w.pool, w.company.String())
	var categoryID string
	w.pool.QueryRow(ctx, `INSERT INTO categories (company_id, name) VALUES ($1, 'Orders') RETURNING id`, w.company.String()).Scan(&categoryID)
	w.must(`INSERT INTO user_categories (company_id, user_id, category_id) VALUES ($1, $2, $3)`, w.company.String(), expert, categoryID)
	var ticketID string
	w.pool.QueryRow(ctx, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel, customer_phone, conversation_id)
		VALUES ($1, 7, 'Cold pizza 100%', 'It was cold.', 'chat', '+39 051 123 4567', $2) RETURNING id`, w.company.String(), conversationID).Scan(&ticketID)

	for q, want := range map[string]int{"": 1, "#7": 1, "051-123": 1, "100%": 1, "nothing like it": 0} {
		code, answer := w.call("GET", "/api/v1/requests?view=all&q="+strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(q, "%", "%25"), "#", "%23"), " ", "+"), "", screensSecret, w.cookie)
		if code != 200 || len(answer["lines"].([]any)) != want {
			t.Fatalf("search %q: %d %v", q, code, answer)
		}
	}
	code, answer := w.call("GET", "/api/v1/requests", "", screensSecret, w.cookie)
	if code != 200 || answer["view"] != "open" || answer["counts"].(map[string]any)["unassigned"] != 1.0 {
		t.Fatalf("an owner lands on open: %v", answer)
	}
	base := "/api/v1/requests/" + ticketID
	if code, _ := w.call("POST", base+"/category", `{"category":"Orders"}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("category")
	}
	_, page := w.call("GET", "/api/v1/requests/7", "", screensSecret, w.cookie)
	request := page["request"].(map[string]any)
	if request["assignedToUserId"] != expert || len(page["people"].([]any)) != 2 {
		t.Fatalf("the category routed it to its expert: %v", request)
	}
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'ticket.assigned'`) != 1 {
		t.Fatal("the expert routing picked is emailed")
	}
	w.call("POST", base+"/assign", `{"assigneeId":"`+owner+`"}`, screensSecret, w.cookie)
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'ticket.assigned'`) != 1 {
		t.Fatal("nobody is emailed for taking a request themselves")
	}
	if code, answer := w.call("POST", base+"/assign", `{"assigneeId":"someone-else"}`, screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "can't take requests") {
		t.Fatalf("a made-up person: %d %v", code, answer)
	}
	if code, _ := w.call("POST", base+"/notes", `{"text":"Called them back."}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("a note")
	}
	_, page = w.call("GET", "/api/v1/requests/7", "", screensSecret, w.cookie)
	history := page["request"].(map[string]any)["history"].([]any)
	last := history[len(history)-1].(map[string]any)
	if last["kind"] != "note" || last["note"] != "Called them back." {
		t.Fatalf("the note, decrypted, last: %v", history)
	}
	if code, _ := w.call("POST", "/api/v1/conversations/"+conversationID+"/done", `{"ticketId":"`+ticketID+`"}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("Done")
	}
	var status string
	var withoutEmail bool
	w.pool.QueryRow(ctx, `SELECT status, solved_without_email FROM tickets WHERE company_id = $1 AND id = $2`, w.company.String(), ticketID).Scan(&status, &withoutEmail)
	if status != "solved" || !withoutEmail {
		t.Fatal("Done closes it without an email")
	}
	if code, _ := w.call("POST", base+"/close", "", screensSecret, w.cookie); code != 409 {
		t.Fatal("closed already")
	}
	if code, _ := w.call("POST", base+"/reopen", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("an owner reopens")
	}
}

// A search is cut at 200 characters, never inside one: 70 Bangla letters are
// 210 bytes, and half a letter is text Postgres refuses.
func TestALongBanglaSearchFindsItsRequest(t *testing.T) {
	w := newAPIWorld(t)
	words := strings.Repeat("ক", 70)
	w.must(`INSERT INTO tickets (company_id, ticket_number, subject, description, channel) VALUES ($1, 3, $2, 'd', 'manual')`, w.company.String(), "অর্ডার "+words)
	code, answer := w.call("GET", "/api/v1/requests?view=all&q="+url.QueryEscape(words), "", screensSecret, w.cookie)
	if code != 200 || len(answer["lines"].([]any)) != 1 {
		t.Fatalf("the request: %d %v", code, answer)
	}
	if code, answer := w.call("GET", "/api/v1/calls?q="+url.QueryEscape(words), "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("the calls: %d %v", code, answer)
	}
}

// A request number past Postgres's integers is no request (not a failure).
func TestARequestNumberPastPostgresIntegersIsNotFound(t *testing.T) {
	w := newAPIWorld(t)
	for _, number := range []string{"2147483647", "2147483648", "99999999999"} {
		if code, _ := w.call("GET", "/api/v1/requests/"+number, "", screensSecret, w.cookie); code != 404 {
			t.Fatalf("request %s: %d", number, code)
		}
	}
}
