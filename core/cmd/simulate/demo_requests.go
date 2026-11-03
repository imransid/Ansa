package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/email"
	"ansa/core/internal/logging"
	"ansa/core/internal/outbox"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
	"ansa/core/internal/tickets"
)

// The restaurant's typed-in requests (All requests, the request pages, the
// Emails page): taken at the counter or on the phone, routed by category and
// to the same customer's person, with notes, one solved with its email, one
// whose email bounced (a mistyped address) and one closed without emailing.
// The running core sends their emails (the development mailbox).
func addTypedInRequests(ctx context.Context, w *world, a demoAccount) error {
	categories, err := categoryIDs(ctx, w, a)
	if err != nil {
		return err
	}
	var karim string
	if err := w.pool.QueryRow(ctx, `SELECT id FROM users WHERE company_id = $1 AND email = $2`, a.company.String(), demoTeammateEmail).Scan(&karim); err != nil {
		return err
	}
	borhani, err := typeInRequest(ctx, w, a, tickets.NewRequest{Subject: "Delivery came without the borhani", CustomerName: "Kamal Uddin", Phone: "+880 1911 000303",
		Description: "Kamal called the restaurant: his delivery last night came without the 2 Borhani he paid for.", CategoryID: categories["Delivery"]})
	if err != nil {
		return err
	}
	if err := addDemoNote(ctx, w, a, karim, borhani, "Called Kamal back: two Borhani go with his next order, free."); err != nil {
		return err
	}
	// The same caller again: routed to the person who has his open request.
	if _, err := typeInRequest(ctx, w, a, tickets.NewRequest{Subject: "Kamal asks when the borhani comes", CustomerName: "Kamal Uddin", Phone: "+880 1911 000303",
		Description: "Kamal called again to ask when the borhani will come."}); err != nil {
		return err
	}
	cake, err := typeInRequest(ctx, w, a, tickets.NewRequest{Subject: "Firni for a birthday on Saturday", CustomerName: "Joya Sarkar", CustomerEmail: "joya.sarkar@example.com",
		Description: "Joya asked at the counter for firni for 12 people on Saturday at 5 pm.", CategoryID: categories["Catering"]})
	if err != nil {
		return err
	}
	if err := addDemoNote(ctx, w, a, a.userID, cake, "Confirmed by phone: ready Saturday at 5 pm, paid in advance by bKash."); err != nil {
		return err
	}
	if err := solveDemoRequest(ctx, w, a, cake, "joya.sarkar@example.com"); err != nil {
		return err
	}
	bank, err := typeInRequest(ctx, w, a, tickets.NewRequest{Subject: "Lunch boxes for the bank on Thursday", CustomerName: "Rezaul Karim", CustomerEmail: "rezaul@bank-typo.example",
		Description: "Rezaul ordered 25 lunch boxes for his bank on Thursday; the address was taken by phone.", CategoryID: categories["Orders"]})
	if err != nil {
		return err
	}
	if err := solveDemoRequest(ctx, w, a, bank, "rezaul@bank-typo.example"); err != nil {
		return err
	}
	if err := bounceDemoEmail(ctx, w, a, bank); err != nil {
		return err
	}
	spam, err := typeInRequest(ctx, w, a, tickets.NewRequest{Subject: "A call offering a business loan", Description: "A sales call, not a customer."})
	if err != nil {
		return err
	}
	if closed, err := tickets.CloseWithoutEmail(ctx, w.pool, a.company, a.userID, spam); err != nil || !closed {
		return refusedStep(err, "closed", "not closed")
	}
	fmt.Fprintln(w.out, "Added typed-in requests: routed, with notes, one solved with an email, one whose email bounced, one closed without emailing.")
	return nil
}

// typeInRequest types a request in as a person does on "New request"; its id.
func typeInRequest(ctx context.Context, w *world, a demoAccount, request tickets.NewRequest) (string, error) {
	number, err := tickets.CreateManual(ctx, w.pool, a.company, a.userID, request)
	if err != nil {
		return "", err
	}
	var id string
	err = w.pool.QueryRow(ctx, `SELECT id::text FROM tickets WHERE company_id = $1 AND ticket_number = $2`, a.company.String(), number).Scan(&id)
	return id, err
}

// addDemoNote adds an internal note, encrypted as the request page's are.
func addDemoNote(ctx context.Context, w *world, a demoAccount, author, ticketID, text string) error {
	noteID, err := conversations.NewID()
	if err != nil {
		return err
	}
	encrypted, err := w.box.Encrypt(text, tickets.NoteContext(a.company, ticketID, noteID))
	if err != nil {
		return err
	}
	if added, err := tickets.AddNote(ctx, w.pool, a.company, author, ticketID, noteID, encrypted); err != nil || !added {
		return refusedStep(err, "noted", "no note")
	}
	return nil
}

// solveDemoRequest marks it solved with the "solved" email to the address shown.
func solveDemoRequest(ctx context.Context, w *world, a demoAccount, ticketID, address string) error {
	solved, queued, err := tickets.Solve(ctx, w.pool, a.company, a.userID, ticketID, address)
	if err != nil || !solved || !queued {
		return refusedStep(err, "solved with an email", fmt.Sprintf("solved %v, email %v", solved, queued))
	}
	return nil
}

// bounceDemoEmail delivers the request's "solved" email here, then tells
// core's own Resend webhook (in this process, signed with a secret made for
// this run) that it bounced, as Resend does for a mistyped address.
func bounceDemoEmail(ctx context.Context, w *world, a demoAccount, ticketID string) error {
	var emailID string
	if err := w.pool.QueryRow(ctx, `SELECT id::text FROM outgoing_emails WHERE company_id = $1 AND ticket_id = $2`, a.company.String(), ticketID).Scan(&emailID); err != nil {
		return err
	}
	limiter := ratelimit.New(w.pool, w.cfg.AuthSecret)
	deliverer := &outbox.Deliverer{Pool: w.pool, Limiter: limiter, Email: &email.Sender{DevFolder: w.cfg.DevFolder}, ForwardingDomain: w.cfg.ForwardingDomain()}
	if outcome, err := deliverer.Deliver(ctx, a.company, emailID, false); err != nil || outcome != outbox.Sent {
		return refusedStep(err, "delivered", outcome)
	}
	var providerID string
	if err := w.pool.QueryRow(ctx, `SELECT provider_message_id FROM outgoing_emails WHERE company_id = $1 AND id = $2`, a.company.String(), emailID).Scan(&providerID); err != nil {
		return err
	}
	secret, err := webhookSecret()
	if err != nil {
		return err
	}
	hook := &resend.Webhook{Pool: w.pool, Limiter: limiter, Log: logging.New(io.Discard), Secret: secret, ForwardingDomain: w.cfg.ForwardingDomain()}
	event, _ := json.Marshal(map[string]any{"type": "email.bounced", "created_at": time.Now().UTC().Format(time.RFC3339), "data": map[string]any{"email_id": providerID}})
	if status := serveInProcess(hook, "/webhooks/resend", event, resend.Sign(event, "msg_"+randomHex(12), secret, time.Now())); status != 200 {
		return commands.Refusal("The demo's bounce wasn't saved by core's webhook.")
	}
	return nil
}

// addUnfetchedEmail adds an email whose content couldn't be fetched from
// Resend (the Emails page then offers "Process again", which fetches it:
// the content waits in .dev-inbound/ as Resend would keep it).
func addUnfetchedEmail(ctx context.Context, w *world, a demoAccount, forwarding string) error {
	emailID := randomHex(16)
	content := map[string]any{"from": "imtiaz.hasan@example.com", "to": []string{forwarding}, "reply_to": []string{}, "subject": "Do you have a room for a meeting lunch?",
		"text": "Hello,\n\nCould we have lunch for 10 people in your family room next Tuesday, with a quiet table for a short meeting?\n\nImtiaz", "html": nil,
		"attachments": []any{}, "headers": map[string]string{"from": "Imtiaz Hasan <imtiaz.hasan@example.com>"}, "authentication": map[string]string{"spf": "pass", "dkim": "pass", "dmarc": "pass"}}
	if err := writeDevInbound(w.cfg.DevFolder, emailID, content); err != nil {
		return err
	}
	// Standing in for three fetches Resend didn't answer (development only).
	_, err := w.pool.Exec(ctx, `INSERT INTO inbound_emails (company_id, resend_email_id, status, ignored_reason, received_at)
		VALUES ($1, $2, 'ignored', 'content_unavailable', now() - interval '2 hours')`, a.company.String(), emailID)
	return err
}

// webhookSecret is a Resend signing secret made for this run.
func webhookSecret() (string, error) {
	key := make([]byte, 24)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return "whsec_" + base64.StdEncoding.EncodeToString(key), nil
}
