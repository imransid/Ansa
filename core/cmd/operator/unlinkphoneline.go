package main

import (
	"context"
	"fmt"

	"ansa/core/internal/commands"
)

// unlink-phone-line unlinks a Vapi phone number from an owner's company (the
// old `pnpm unlink:phone-line`: the undo of link-phone-line, e.g. after
// linking the wrong id). A number that has calls stays linked: its calls
// need it (Postgres refuses the delete). Like linking, it prints the
// company and changes nothing until it runs again with --yes.
var unlinkPhoneLineCommand = command{
	usage: "unlink-phone-line <owner email> <vapi phone number id> [--yes]",
	fits:  confirmable(2),
	run:   runUnlinkPhoneLine,
}

func runUnlinkPhoneLine(ctx context.Context, w *world, args []string) error {
	values, confirmed := commands.SplitConfirm(args)
	numberID := commands.CleanPhoneNumberID(values[1])
	if numberID == "" {
		return commands.Refusal("That isn't a Vapi phone number id (3-100 letters, digits, _ or -).")
	}
	company, err := w.owner(ctx, values[0])
	if err != nil {
		return err
	}
	if !confirmed {
		return commands.AskToConfirm("unlink " + numberID + " from it")
	}
	outcome, err := commands.UnlinkPhoneLine(ctx, w.pool, company.ID, numberID)
	if err != nil {
		return err
	}
	switch outcome {
	case commands.NoSuchLine:
		return commands.Refusal(fmt.Sprintf("%q has no number %s. Nothing was changed.", company.Name, numberID))
	case commands.LineHasCalls:
		return commands.Refusal("This number already has calls, so it stays linked.")
	}
	fmt.Fprintf(w.out, "Unlinked %s from %q.\n", numberID, company.Name)
	return nil
}
