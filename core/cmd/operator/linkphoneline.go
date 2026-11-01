package main

import (
	"context"
	"fmt"

	"ansa/core/internal/commands"
)

// link-phone-line links a Vapi phone number to an owner's company, so calls
// to that number are saved for that company (the old `pnpm
// link:phone-line`). Owners can't link numbers themselves: the numbers live
// in ansa's own Vapi account, and whoever's company holds a number gets its
// calls (transcripts, callers' numbers). It prints the company and links
// nothing until it runs again with --yes. Undo, before the number's first
// call: unlink-phone-line. For local testing any id works ("pn-local-test").
var linkPhoneLineCommand = command{
	usage: "link-phone-line <owner email> <vapi phone number id> [--yes]",
	fits:  confirmable(2),
	run:   runLinkPhoneLine,
}

func runLinkPhoneLine(ctx context.Context, w *world, args []string) error {
	values, confirmed := commands.SplitConfirm(args)
	numberID := commands.CleanPhoneNumberID(values[1])
	if numberID == "" {
		return commands.Refusal("That isn't a Vapi phone number id: paste the number's id from the Vapi dashboard (3-100 letters, digits, _ or -).")
	}
	company, err := w.owner(ctx, values[0])
	if err != nil {
		return err
	}
	holder, err := commands.PhoneLineHolder(ctx, w.pool, company.ID, numberID)
	if err != nil {
		return err
	}
	switch holder {
	case commands.LineOfThisCompany:
		fmt.Fprintln(w.out, "Already linked to this company.")
		return nil
	case commands.LineOfAnotherCompany:
		return commands.Refusal("This number already belongs to another company. Nothing was changed.")
	}
	if !confirmed {
		return commands.AskToConfirm("link " + numberID + " to it")
	}
	linked, err := commands.LinkPhoneLine(ctx, w.pool, company.ID, numberID)
	if err != nil {
		return err
	}
	if !linked {
		return commands.Refusal("This number was linked to a company a moment ago. Nothing was changed: run the command again to see where.")
	}
	fmt.Fprintf(w.out, "Linked %s to %q. Its Connections page now shows the number.\n", numberID, company.Name)
	return nil
}
