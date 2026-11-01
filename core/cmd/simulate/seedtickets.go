package main

import (
	"context"
	"fmt"

	"ansa/core/internal/tickets"
)

// seed-tickets adds sample requests to an owner's company (the old `pnpm
// seed:tickets`), so the Inbox's requests have something to show before
// real calls and emails make some. Each is made by core's own "New
// request" path (numbered, its history, routed, its assignee emailed), as
// typed in by that owner. Running it again adds another batch.
var seedTicketsTool = tool{
	usage: "seed-tickets <owner email>",
	does:  "writes sample requests",
	fits:  exactly(1),
	run:   runSeedTickets,
}

// Fictional customers: phone numbers in the 555-01xx range kept for
// fiction, addresses on example domains.
var sampleRequests = []tickets.NewRequest{
	{Subject: "Order arrived damaged", Description: "Customer received order with a cracked screen. Wants a replacement, not a refund.",
		CustomerName: "Maria Lopez", Phone: "+1 555 0101"},
	{Subject: "Charged twice for one order", Description: "Two identical charges on the card statement. AI could not see payment details.",
		CustomerName: "Tom Becker", CustomerEmail: "tom.becker@example.com"},
	{Subject: "Cannot log in after password reset", Description: "Reset link worked, but the new password is rejected. Tried twice on the call.",
		Phone: "+1 555 0102"},
	{Subject: "Wants to change delivery address", Description: "Order already shipped. Customer moved last week and needs it redirected.",
		CustomerEmail: "sam.okafor@example.com"},
	{Subject: "Invoice needs company VAT number", Description: "Business customer needs the invoice reissued with their VAT number on it.",
		CustomerName: "Lena Fischer", CustomerEmail: "lena@fischer-gmbh.example.com"},
	{Subject: "Product stopped working after update", Description: "Device stuck on the logo screen since last night's update. Restart did not help.",
		CustomerName: "Ahmed Khan", Phone: "+1 555 0103"},
	{Subject: "Asking for a bulk discount", Description: "Wants 200 units for a school. AI is not allowed to offer custom pricing.",
		CustomerName: "Grace Kim", Phone: "+1 555 0104", CustomerEmail: "g.kim@school.example.com"},
	{Subject: "Unhappy with the last support call", Description: "Customer asked to speak to a human about a previous call. Calm but firm."},
}

func runSeedTickets(ctx context.Context, w *world, args []string) error {
	company, err := w.owner(ctx, args[0])
	if err != nil {
		return err
	}
	for _, sample := range sampleRequests {
		number, err := tickets.CreateManual(ctx, w.pool, company.ID, company.OwnerID, sample)
		if err != nil {
			return err
		}
		fmt.Fprintf(w.out, "Created request #%d: %s\n", number, sample.Subject)
	}
	fmt.Fprintf(w.out, "See them on %s/inbox/requests\n", w.cfg.AppURL)
	return nil
}
