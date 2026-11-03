package api

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/session"
)

func TestHomeAndTheOwnersSwitches(t *testing.T) {
	w := newAPIWorld(t)
	code, page := w.call("GET", "/api/v1/home", "", screensSecret, w.cookie)
	presence := page["presence"].(map[string]any)
	if code != 200 || presence["status"] != "on" || presence["coverText"] != "ansa answers every message" || presence["canManage"] != true {
		t.Fatalf("home: %d %v", code, page)
	}
	steps := page["gettingStarted"].([]any)
	if len(steps) != 3 || steps[0].(map[string]any)["key"] != "channel" || page["newOrders"] != 1.0 {
		t.Fatalf("getting started and new orders: %v", page)
	}
	if code, _ := w.call("POST", "/api/v1/assistant/status", `{"status":"paused"}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("pause: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/assistant/answer-when", `{"answerWhen":"when_away"}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("only when I'm away")
	}
	if code, _ := w.call("POST", "/api/v1/assistant/away", `{"away":true}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("I'm away")
	}
	_, page = w.call("GET", "/api/v1/home", "", screensSecret, w.cookie)
	presence = page["presence"].(map[string]any)
	if presence["status"] != "paused" || presence["coverText"] != "You're away: ansa answers" || page["awaySummary"] == nil {
		t.Fatalf("after the switches: %v", page)
	}
	if code, _ := w.call("POST", "/api/v1/home/away-summary/seen", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("got it")
	}

	member := database.TestOwner(t, w.pool, w.company.String())
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), member)
	token, _ := conversations.NewID()
	w.must(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, member)
	t.Cleanup(func() { w.pool.Exec(context.Background(), `DELETE FROM sessions WHERE token = $1`, token) })
	memberCookie := "better-auth.session_token=" + session.SignValue(token, authSecret)
	if code, answer := w.call("POST", "/api/v1/assistant/status", `{"status":"on"}`, screensSecret, memberCookie); code != 403 || answer["error"] != "Only owners can pause or start ansa." {
		t.Fatalf("a member can't: %d %v", code, answer)
	}
	if _, page := w.call("GET", "/api/v1/home", "", screensSecret, memberCookie); len(page["gettingStarted"].([]any)) != 0 {
		t.Fatal("members don't get the owner's checklist")
	}
}

// A request outside any conversation (typed in, a hidden caller's) is listed
// by no conversation on Home: the open ones nobody has, or the viewer has,
// are counted for them.
func TestHomeCountsTheRequestsNoConversationListsForTheViewer(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	owner := w.ownerID()
	colleague := database.TestOwner(t, w.pool, w.company.String())
	var conversationID string
	w.pool.QueryRow(ctx, `SELECT id FROM conversations WHERE company_id = $1`, w.company.String()).Scan(&conversationID)
	typedIn := `INSERT INTO tickets (company_id, ticket_number, subject, description, channel, assigned_to_user_id, assigned_automatically)
		VALUES ($1, $2, 'Typed in', 'd', 'manual', $3, $4)`
	w.must(typedIn, w.company.String(), 1, nil, nil)
	w.must(typedIn, w.company.String(), 2, owner, false)
	w.must(typedIn, w.company.String(), 3, owner, false)
	w.must(typedIn, w.company.String(), 4, colleague, false)
	w.must(`INSERT INTO tickets (company_id, ticket_number, subject, description, channel, conversation_id) VALUES ($1, 5, 'In a chat', 'd', 'chat', $2)`, w.company.String(), conversationID)
	w.must(`INSERT INTO tickets (company_id, ticket_number, subject, description, channel, status, solved_at, solved_by_user_id)
		VALUES ($1, 6, 'Solved', 'd', 'manual', 'solved', now(), $2)`, w.company.String(), owner)

	_, page := w.call("GET", "/api/v1/home", "", screensSecret, w.cookie)
	support := page["overview"].(map[string]any)["support"].(map[string]any)
	if support["requestsWaitingForYou"] != 3.0 || support["openTickets"] != 5.0 {
		t.Fatalf("nobody's and the owner's two, not the colleague's, the chat's (its conversation is listed) or the solved one: %v", support)
	}
	token, _ := conversations.NewID()
	w.must(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, colleague)
	t.Cleanup(func() { w.pool.Exec(context.Background(), `DELETE FROM sessions WHERE token = $1`, token) })
	colleagueCookie := "better-auth.session_token=" + session.SignValue(token, authSecret)
	_, page = w.call("GET", "/api/v1/home", "", screensSecret, colleagueCookie)
	if support := page["overview"].(map[string]any)["support"].(map[string]any); support["requestsWaitingForYou"] != 2.0 {
		t.Fatalf("for the colleague: nobody's and their own: %v", support)
	}
}
