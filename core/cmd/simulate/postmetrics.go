package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"ansa/core/internal/analytics"
	"ansa/core/internal/commands"
)

// post-metrics saves made-up numbers for a post the development stand-in
// "published" (the old `pnpm simulate:post-metrics`), so the Analytics page
// and "Review performance" can be tried before any platform gives real
// ones. Labeled "Simulated (development)" wherever they show. A post to a
// real account is refused (its numbers come from its platform), and so is
// any number its platform doesn't have.
var postMetricsTool = tool{
	usage: strings.TrimPrefix(analytics.SimulateUsage, usagePrefix),
	does:  "writes made-up numbers into the database",
	fits:  func(args []string) bool { return len(args) >= 2 },
	run:   runPostMetrics,
}

func runPostMetrics(ctx context.Context, w *world, args []string) error {
	_, refusal, err := analytics.SimulatePostMetrics(ctx, w.pool, args[0], args[1:], !w.cfg.IsProduction())
	if err != nil {
		return err
	}
	if refusal != "" {
		return commands.Refusal(refusal)
	}
	values, _ := analytics.ReadMetricArguments(args[1:])
	var saved []string
	for _, value := range values {
		saved = append(saved, value.Column+"="+strconv.FormatInt(value.Value, 10))
	}
	fmt.Fprintf(w.out, "Saved simulated numbers (%s). See them on %s/cofounder/analytics\n", strings.Join(saved, " "), w.cfg.AppURL)
	return nil
}
