package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/calls"
	"ansa/core/internal/commands"
	"ansa/core/internal/logging"
)

// try-brain asks the brain about one stored call and prints its verdict
// (the old `pnpm try:brain`): a dry run, nothing is claimed or saved. It
// goes through core's own call analysis (the same request and the same
// checks of the answer) to the brain at BRAIN_URL, with the engine the
// brain has: with ANTHROPIC_API_KEY in the brain's settings, ONE real, paid
// model call (unless a rule decides first: no transcript, an abnormal
// end); without it the brain answers "model_unavailable" for free. Prints
// codes only: never the transcript, the prompt or the AI's own words.
var tryBrainTool = tool{
	usage: "try-brain <owner email> <call id (in the call page's address)>",
	does:  "asks the brain about a stored call",
	fits:  exactly(2),
	run:   runTryBrain,
}

var callIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// The brain's longest call decision: 60 s a try with 2 retries, and the waits.
const tryBrainTimeout = 260 * time.Second

func runTryBrain(ctx context.Context, w *world, args []string) error {
	callID := strings.ToLower(strings.TrimSpace(args[1]))
	if !callIDPattern.MatchString(callID) {
		return commands.Refusal("That isn't a call id: copy it from the call page's address (/calls/<id>).")
	}
	company, err := w.owner(ctx, args[0])
	if err != nil {
		return err
	}
	analyzer := &calls.Analyzer{Pool: w.pool, Box: w.box, Log: logging.New(os.Stderr), Brain: brainclient.New(w.cfg.BrainURL, w.cfg.BrainSharedSecret, tryBrainTimeout)}
	tried, err := analyzer.TryDecision(ctx, company.ID, callID)
	if errors.Is(err, calls.ErrNoSuchCall) {
		return commands.Refusal("This company has no call with that id.")
	}
	if err != nil {
		return err
	}
	printTried(w, tried)
	return nil
}

func printTried(w *world, tried calls.Tried) {
	fmt.Fprintf(w.out, "Outcome: %s\n", tried.Outcome)
	decidedBy := tried.Source
	if tried.Source == "rule" {
		decidedBy += " (the AI was not asked)"
	}
	fmt.Fprintf(w.out, "Decided by: %s\n", decidedBy)
	fmt.Fprintf(w.out, "Reason: %s (%s)\n", tried.ReasonCode, calls.DescribeReason(tried.ReasonCode, tried.ErrorClass))
	fmt.Fprintf(w.out, "Category: %s\n", orNone(tried.Category))
	fmt.Fprintf(w.out, "Model: %s\n", orNone(tried.Model))
	fmt.Fprintln(w.out, "Dry run: nothing was saved.")
}

func orNone(text string) string {
	if text == "" {
		return "(none)"
	}
	return text
}
