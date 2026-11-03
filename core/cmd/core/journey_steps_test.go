package main

import (
	"context"
	"fmt"
	"strings"

	"ansa/core/internal/conversations"
)

// owner is a person who signed up through the journey: their login cookie,
// address and company.
type owner struct {
	cookie, address, companyID, userID string
}

// signUp signs a new owner up and confirms the address with the emailed link
// and the password, as the signup and verify-email pages do.
func (j *journey) signUp(name string) owner {
	id, _ := conversations.NewID()
	person := owner{address: id[:8] + "@" + j.domain}
	password := "journey-password-" + id[:8]
	body := fmt.Sprintf(`{"name":%q,"email":%q,"password":%q,"clientIp":%q,"userAgent":"journey"}`, name, person.address, password, j.ip)
	if code, answer := j.call("POST", "/api/v1/auth/signup", body, ""); code != 200 {
		j.t.Fatalf("signup: %d %v", code, answer)
	}
	token := j.newestEmailLink(person.address)
	body = fmt.Sprintf(`{"token":%q,"password":%q,"clientIp":%q,"userAgent":"journey"}`, token, password, j.ip)
	code, answer := j.call("POST", "/api/v1/auth/confirm", body, "")
	cookies, _ := answer["cookies"].([]any)
	if code != 200 || len(cookies) == 0 {
		j.t.Fatalf("confirming the address with the link and the password: %d %v", code, answer)
	}
	var pairs []string
	for _, each := range cookies {
		cookie := each.(map[string]any)
		pairs = append(pairs, fmt.Sprintf("%s=%s", cookie["name"], cookie["value"]))
	}
	person.cookie = strings.Join(pairs, "; ")
	err := j.pool.QueryRow(context.Background(), `SELECT company_id::text, id FROM users WHERE email = $1`, person.address).Scan(&person.companyID, &person.userID)
	if err != nil {
		j.t.Fatalf("the new owner: %v", err)
	}
	j.identifiers = append(j.identifiers, person.address, person.address+" "+j.ip, person.companyID, person.userID)
	return person
}

// mustSave posts a form's body as the person and wants it saved.
func (j *journey) mustSave(person owner, path, body string) map[string]any {
	code, answer := j.call("POST", path, body, person.cookie)
	if code != 200 {
		j.t.Fatalf("%s: %d %v", path, code, answer)
	}
	return answer
}

// setUpPizzeria goes through the setup steps as the welcome pages do: a
// restaurant open around the clock (so the journey never meets closing
// time), taking orders for delivery and pickup in euros.
func (j *journey) setUpPizzeria(person owner) {
	allDay := `[{"opens":"00:00","closes":"00:00"}]`
	week := fmt.Sprintf(`{"mon":%[1]s,"tue":%[1]s,"wed":%[1]s,"thu":%[1]s,"fri":%[1]s,"sat":%[1]s,"sun":%[1]s}`, allDay)
	steps := []struct{ section, body string }{
		{"business", `{"kind":"business","companyName":"Pizzeria Lena","businessType":"restaurant","description":"Wood-fired pizza in Bologna."}`},
		{"contact", `{"address":"Via Roma 10, Bologna","phone":"+39 051 000 000"}`},
		{"hours", `{"timeZone":"Europe/Rome","hours":` + week + `}`},
		{"orders", `{"takesOrders":true,"delivery":true,"deliveryNote":"","deliveryFee":"2.50","pickup":true,"paymentNote":"Cash or card.","currency":"EUR"}`},
		{"assistant", `{"instructions":"","holdingReply":"Thanks! Someone from Pizzeria Lena will get back to you soon."}`},
		{"connect", `{}`},
		{"finish", `{}`},
	}
	for _, step := range steps {
		j.mustSave(person, "/api/v1/setup/"+step.section+"?from=setup", step.body)
	}
	j.mustSave(person, "/api/v1/menu/items", `{"category":"Pizza","name":"Margherita","description":"Tomato, mozzarella, basil.","price":"9.50"}`)
}

// connectTelegram connects the owner's Telegram account as the Connections
// page and Telegram do: a link code, the owner's Start in ansa's bot, then
// the bot added as the account's chatbot.
func (j *journey) connectTelegram(person owner, side *telegramSide) {
	answer := j.mustSave(person, "/api/v1/channels/telegram/link", `{}`)
	j.telegramSends(side.start(codeIn(j.t, answer["link"])))
	j.telegramSends(side.addsTheBot())
	j.identifiers = append(j.identifiers, side.ownerID)
	j.telegramConnections = append(j.telegramConnections, side.connectionID)
}

// customerWrites brings the customer's message in through Telegram's
// webhook and lets core's workers answer it; it returns what ansa sent back.
func (j *journey) customerWrites(person owner, side *telegramSide, text string) string {
	before := len(j.telegram.toCustomer(side.customerChatID, side.connectionID))
	j.telegramSends(side.customerWrites(text))
	j.runJobs(person.companyID)
	sent := j.telegram.toCustomer(side.customerChatID, side.connectionID)
	if len(sent) == before {
		j.t.Fatalf("ansa didn't answer %q", text)
	}
	return strings.Join(sent[before:], "\n")
}

// openOrders is the Orders page's "To do" list.
func (j *journey) openOrders(person owner) []map[string]any {
	code, answer := j.call("GET", "/api/v1/orders", "", person.cookie)
	if code != 200 {
		j.t.Fatalf("orders: %d %v", code, answer)
	}
	var open []map[string]any
	for _, order := range answer["open"].([]any) {
		open = append(open, order.(map[string]any))
	}
	return open
}
