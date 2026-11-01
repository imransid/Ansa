package main

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/messenger"
	"ansa/core/internal/plaintext"
)

// messenger brings a customer's Messenger message into the Inbox through
// the company's development stand-in Facebook Page (the old `pnpm
// simulate:messenger`), so Messenger can be tried before ansa's Meta app
// exists: connect the stand-in Page on Settings → Connections first. It
// saves IN THIS PROCESS with the same functions core's Messenger webhook
// saves with (the message encrypted in the customer's conversation, the
// assistant's reply queued), not through the webhook: the stand-in Page's
// id ("dev:stand-in") isn't one Meta signs, and development has no Meta app
// secret to sign with. A running core answers it (a file in .dev-messages/).
var messengerTool = tool{
	usage: `messenger <owner email> "<customer name>" "<message>"`,
	does:  "writes a made-up customer message",
	fits:  exactly(3),
	run:   runMessenger,
}

var notLettersOrDigits = regexp.MustCompile(`[^a-z0-9]+`)

func runMessenger(ctx context.Context, w *world, args []string) error {
	company, err := w.owner(ctx, args[0])
	if err != nil {
		return err
	}
	pageID, err := commands.StandInFacebookPage(ctx, w.pool, company.ID)
	if err != nil {
		return err
	}
	if pageID == "" {
		return commands.Refusal(fmt.Sprintf("This company has no stand-in Facebook Page. Connect one on %s/settings/channels first.", w.cfg.AppURL))
	}
	name := strings.TrimSpace(cutRunes(plaintext.SingleLine(strings.TrimSpace(args[1])), 100))
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	body, err := w.box.Encrypt(cutRunes(strings.TrimSpace(args[2]), 4000), conversations.MessageContext(company.ID, id))
	if err != nil {
		return err
	}
	contact := conversations.ContactKey{Channel: conversations.ChannelMessenger, ExternalID: messenger.ContactID(pageID, standInPSID(name))}
	if name != "" {
		contact.DisplayName = &name
	}
	turn, err := conversations.InsertCustomerMessage(ctx, w.pool, company.ID, contact, conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: "stand-in-" + id})
	if err != nil {
		return err
	}
	if turn != nil {
		if err := conversations.QueueReply(ctx, w.pool, turn); err != nil {
			return err
		}
	}
	fmt.Fprintf(w.out, "Saved a Messenger message for %q. A running core answers it in a moment (see .dev-messages/ and %s/inbox?view=all).\n", company.Name, w.cfg.AppURL)
	return nil
}

// standInPSID: the same name is the same made-up customer of the Page (as
// the old script made it).
func standInPSID(name string) string {
	psid := strings.Trim(notLettersOrDigits.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if psid == "" {
		return "customer"
	}
	return psid
}
