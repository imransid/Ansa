package main

import (
	"context"
	"strings"
	"testing"
)

const replyJobs = `SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'assistant.reply'`

// The stand-in chat: one message saved encrypted in the customer's
// conversation, the assistant's reply queued for the running core.
func TestMessageSavesAStandInCustomersMessageAndQueuesTheReply(t *testing.T) {
	w := newTestWorld(t)
	if _, err := w.run("message", "nobody@core-test.example", "Lena", "Hi"); err == nil || !strings.Contains(err.Error(), "not the confirmed address of an owner") {
		t.Fatalf("an address that isn't an owner's: %v", err)
	}
	out, err := w.run("message", w.owner, "Lena", "Are you open tonight?")
	if err != nil || !strings.Contains(out, `Saved a message for "core test company"`) || strings.Contains(out, "open tonight") {
		t.Fatalf("saved: %q %v", out, err)
	}
	if w.count(`SELECT count(*) FROM messages JOIN contacts ON contacts.company_id = messages.company_id AND contacts.id = (
		SELECT contact_id FROM conversations WHERE company_id = $1 AND id = messages.conversation_id)
		WHERE messages.company_id = $1 AND contacts.channel = 'stand_in' AND messages.body_encrypted LIKE 'v1:%'`) != 1 || w.count(replyJobs) != 1 {
		t.Fatal("one encrypted message from the stand-in contact, one reply queued")
	}
}

// The stand-in Telegram account: refused until it is connected; then the
// message goes through core's Telegram webhook code, and the same name is
// the same customer.
func TestTelegramGoesThroughCoresWebhookCodeForTheStandInAccount(t *testing.T) {
	w := newTestWorld(t)
	w.forgetRateLimits([2]string{"telegram-webhook", "127.0.0.1"})
	if _, err := w.run("telegram", w.owner, "Lena", "Hi"); err == nil || !strings.Contains(err.Error(), "no stand-in Telegram account") {
		t.Fatalf("without a stand-in: %v", err)
	}
	_, err := w.pool.Exec(context.Background(), `
		INSERT INTO channel_connections (company_id, channel, external_id, account_telegram_id, account_chat_id, display_name, status, is_stand_in, connected_by_user_id)
		VALUES ($1, 'telegram', $2, '1', '1', 'Stand-in Telegram account', 'connected', true, $3)`, w.company.String(), "stand-in:"+randomHex(8), w.ownerID)
	if err != nil {
		t.Fatalf("connecting the stand-in: %v", err)
	}
	for _, text := range []string{"Are you open tonight?", "And tomorrow?"} {
		if out, err := w.run("telegram", w.owner, "Lena Moretti", text); err != nil || !strings.Contains(out, "Saved a Telegram message") {
			t.Fatalf("saved: %q %v", out, err)
		}
	}
	telegramContacts := `SELECT count(*) FROM contacts WHERE company_id = $1 AND channel = 'telegram' AND display_name = 'Lena Moretti'`
	if w.count(telegramContacts) != 1 || w.count(`SELECT count(*) FROM messages WHERE company_id = $1`) != 2 || w.count(replyJobs) < 1 {
		t.Fatal("two messages from one Telegram customer, and a reply queued")
	}
}

// The stand-in Facebook Page: refused until it is connected; then the
// customer is "dev:stand-in:<name>" on that Page.
func TestMessengerSavesForTheStandInPage(t *testing.T) {
	w := newTestWorld(t)
	if _, err := w.run("messenger", w.owner, "Lena", "Hi"); err == nil || !strings.Contains(err.Error(), "no stand-in Facebook Page") {
		t.Fatalf("without a stand-in: %v", err)
	}
	_, err := w.pool.Exec(context.Background(), `
		INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id, is_stand_in)
		VALUES ($1, 'facebook', 'dev:stand-in', 'Development stand-in', 'page', 'v1:x:y:z', $2, true)`, w.company.String(), w.ownerID)
	if err != nil {
		t.Fatalf("connecting the stand-in Page: %v", err)
	}
	if out, err := w.run("messenger", w.owner, "Lena O'Brien", "Do you deliver?"); err != nil || !strings.Contains(out, "Saved a Messenger message") {
		t.Fatalf("saved: %q %v", out, err)
	}
	if w.count(`SELECT count(*) FROM contacts WHERE company_id = $1 AND channel = 'messenger' AND external_id = 'dev:stand-in:lena-o-brien'`) != 1 || w.count(replyJobs) != 1 {
		t.Fatal("the Page's customer, and a reply queued")
	}
	var body string
	w.pool.QueryRow(context.Background(), `SELECT body_encrypted FROM messages WHERE company_id = $1`, w.company.String()).Scan(&body)
	if !strings.HasPrefix(body, "v1:") {
		t.Fatal("the message is encrypted")
	}
}

// Sample requests through core's own "New request" path: numbered, with
// their history, typed in by the owner.
func TestSeedTicketsMakesTheSampleRequests(t *testing.T) {
	w := newTestWorld(t)
	out, err := w.run("seed-tickets", w.owner)
	if err != nil || !strings.Contains(out, "Created request #1: Order arrived damaged") || !strings.Contains(out, "Created request #8: Unhappy with the last support call") {
		t.Fatalf("seeded: %q %v", out, err)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND channel = 'manual' AND status = 'open'`) != len(sampleRequests) ||
		w.count(`SELECT count(*) FROM ticket_activity WHERE company_id = $1 AND kind = 'created' AND actor_user_id = $2`, w.ownerID) != len(sampleRequests) {
		t.Fatal("every sample is an open request the owner made")
	}
}

// The stand-in WhatsApp number: refused until it is connected; then the
// message goes through core's own saving code, and the same name is the
// same customer.
func TestWhatsAppSavesForTheStandInNumber(t *testing.T) {
	w := newTestWorld(t)
	if _, err := w.run("whatsapp", w.owner, "Lena", "Hi"); err == nil || !strings.Contains(err.Error(), "no stand-in WhatsApp number") {
		t.Fatalf("without a stand-in: %v", err)
	}
	_, err := w.pool.Exec(context.Background(), `
		INSERT INTO whatsapp_numbers (company_id, waba_id, phone_number_id, display_phone_number, is_stand_in, connected_by_user_id)
		VALUES ($1, 'stand-in:w', 'stand-in:n', '+00 000 000 000', true, $2)`, w.company.String(), w.ownerID)
	if err != nil {
		t.Fatalf("connecting the stand-in number: %v", err)
	}
	for _, text := range []string{"Are you open tonight?", "And tomorrow?"} {
		if out, err := w.run("whatsapp", w.owner, "Lena O'Brien", text); err != nil || !strings.Contains(out, "Saved a WhatsApp message") {
			t.Fatalf("saved: %q %v", out, err)
		}
	}
	if w.count(`SELECT count(*) FROM contacts WHERE company_id = $1 AND channel = 'whatsapp' AND external_id = 'stand-in:n:XX.lenaobrien' AND display_name = 'Lena O''Brien'`) != 1 ||
		w.count(`SELECT count(*) FROM messages WHERE company_id = $1 AND body_encrypted LIKE 'v1:%'`) != 2 || w.count(replyJobs) < 1 {
		t.Fatal("two encrypted messages from one WhatsApp customer, and a reply queued")
	}
}
