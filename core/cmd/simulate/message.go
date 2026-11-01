package main

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// message brings a customer's chat message into a company's Inbox through
// the development stand-in channel (the old `pnpm simulate:message`), so
// core can be tried without Telegram or Messenger. Each run is one new
// message from the customer named; the same name joins the same
// conversation. A running core answers it like a real chat (its reply is a
// file in .dev-messages/).
var messageTool = tool{
	usage: `message <owner email> "<customer name>" "<message>"`,
	does:  "writes a made-up customer message",
	fits:  exactly(3),
	run:   runMessage,
}

func runMessage(ctx context.Context, w *world, args []string) error {
	company, err := w.owner(ctx, args[0])
	if err != nil {
		return err
	}
	saved, err := saveStandInMessage(ctx, w.pool, w.box, company.ID, args[1], args[2])
	if err != nil {
		return err
	}
	fmt.Fprintf(w.out, "Saved a message for %q. A running core answers it in a moment (see .dev-messages/ and %s/inbox?view=all).\n", company.Name, w.cfg.AppURL)
	if !saved {
		fmt.Fprintln(w.out, "(The same message was saved before: nothing new.)")
	}
	return nil
}

// saveStandInMessage saves the stand-in customer's message (the contact is
// the name, as the old standInContact) and queues the assistant's reply.
func saveStandInMessage(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, customer, text string) (bool, error) {
	name := cutRunes(plaintext.SingleLine(customer), 200)
	if name == "" {
		name = "Stand-in customer"
	}
	text = cutRunes(strings.TrimSpace(text), 4000)
	id, err := conversations.NewID()
	if err != nil {
		return false, err
	}
	body, err := box.Encrypt(text, conversations.MessageContext(company, id))
	if err != nil {
		return false, err
	}
	contact := conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: strings.ToLower(name), DisplayName: &name}
	turn, err := conversations.InsertCustomerMessage(ctx, pool, company, contact, conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: "stand-in-" + id})
	if err != nil || turn == nil {
		return false, err
	}
	return true, conversations.QueueReply(ctx, pool, turn)
}

// cutRunes keeps at most max characters (never half of one).
func cutRunes(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return string([]rune(text)[:max])
}
