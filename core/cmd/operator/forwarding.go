package main

import (
	"context"
	"fmt"

	"ansa/core/internal/commands"
)

// show-forwarding-address prints an owner's company's forwarding address
// (the old `pnpm show:forwarding-address`): the address its support mailbox
// forwards to, as its Connections page shows it. Nobody links or picks it:
// the database made it with the company. It changes nothing.
var showForwardingAddressCommand = command{
	usage: "show-forwarding-address <owner email>",
	fits:  plain(1),
	run:   runShowForwardingAddress,
}

// replace-forwarding-address gives an owner's company a NEW forwarding
// address (the old `pnpm replace:forwarding-address`), for one that gets
// spam. The old address stops at once: the company must forward its support
// mailbox to the new one (Gmail asks to confirm it again), and customer
// replies to emails sent before no longer arrive. So it prints the company
// and changes nothing until it runs again with --yes.
var replaceForwardingAddressCommand = command{
	usage: "replace-forwarding-address <owner email> [--yes]",
	fits:  confirmable(1),
	run:   runReplaceForwardingAddress,
}

// Without INBOUND_EMAIL_DOMAIN the address would be printed on the
// development domain, which receives nothing: it would look right, and a
// company forwarding to it would silently get nothing.
var errNoInboundDomain = commands.Refusal(`INBOUND_EMAIL_DOMAIN is not set. Run: INBOUND_EMAIL_DOMAIN=<production domain> DATABASE_URL="<direct url>" make ... (nothing was changed).`)

func runShowForwardingAddress(ctx context.Context, w *world, args []string) error {
	if w.cfg.InboundEmailDomain == "" {
		return errNoInboundDomain
	}
	company, err := w.owner(ctx, args[0])
	if err != nil {
		return err
	}
	address, err := commands.ForwardingAddress(ctx, w.pool, company.ID, w.cfg.InboundEmailDomain)
	if err != nil {
		return err
	}
	fmt.Fprintln(w.out, address)
	return nil
}

func runReplaceForwardingAddress(ctx context.Context, w *world, args []string) error {
	values, confirmed := commands.SplitConfirm(args)
	// Checked before anything changes, for the reason above.
	if w.cfg.InboundEmailDomain == "" {
		return errNoInboundDomain
	}
	company, err := w.owner(ctx, values[0])
	if err != nil {
		return err
	}
	if !confirmed {
		return commands.AskToConfirm("give it a new forwarding address (the old one stops working at once)")
	}
	address, err := commands.ReplaceForwardingAddress(ctx, w.pool, company.ID, w.cfg.InboundEmailDomain)
	if err != nil {
		return err
	}
	fmt.Fprintf(w.out, "New forwarding address: %s\n", address)
	fmt.Fprintln(w.out, "The old one no longer works. The company must forward its support mailbox to the new one.")
	return nil
}
