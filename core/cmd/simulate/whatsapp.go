package main

import (
	"context"
	"fmt"
	"strings"

	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/whatsapp"
)

// whatsapp brings a customer's WhatsApp message into the Inbox through the
// company's development stand-in number, so WhatsApp can be tried before
// ansa's Meta app exists: connect the stand-in number on Settings →
// Connections first. It saves IN THIS PROCESS with the function core's
// WhatsApp webhook saves with (whatsapp.SaveEvent: the message encrypted in
// the customer's conversation, the assistant's reply queued), not through
// the webhook: development has no Meta app secret to sign with. A running
// core answers it (a file in .dev-messages/).
var whatsappTool = tool{
	usage: `whatsapp <owner email> "<customer name>" "<message>"`,
	does:  "writes a made-up WhatsApp customer message",
	fits:  exactly(3),
	run:   runWhatsApp,
}

func runWhatsApp(ctx context.Context, w *world, args []string) error {
	company, err := w.owner(ctx, args[0])
	if err != nil {
		return err
	}
	phoneNumberID, err := commands.StandInWhatsAppNumber(ctx, w.pool, company.ID)
	if err != nil {
		return err
	}
	if phoneNumberID == "" {
		return commands.Refusal(fmt.Sprintf("This company has no stand-in WhatsApp number. Connect one on %s/settings/channels first.", w.cfg.AppURL))
	}
	name := strings.TrimSpace(cutRunes(plaintext.SingleLine(strings.TrimSpace(args[1])), 100))
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	event := whatsapp.Event{Kind: whatsapp.KindMessage, PhoneNumberID: phoneNumberID, CustomerID: standInCustomer(name), CustomerName: name,
		MessageID: "stand-in-" + id, Text: cutRunes(strings.TrimSpace(args[2]), 4000), MessageType: "text"}
	if err := whatsapp.SaveEvent(ctx, w.pool, w.box, company.ID, event); err != nil {
		return err
	}
	fmt.Fprintf(w.out, "Saved a WhatsApp message for %q. A running core answers it in a moment (see .dev-messages/ and %s/inbox?view=all).\n", company.Name, w.cfg.AppURL)
	return nil
}

// standInCustomer: the same name is the same made-up customer of the
// number (a made-up business-scoped id, as WhatsApp's look: "XX.<name>").
func standInCustomer(name string) string {
	return "XX." + strings.ReplaceAll(standInPSID(name), "-", "")
}
