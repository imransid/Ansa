package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"ansa/core/internal/analytics"
	"ansa/core/internal/config"
	"ansa/core/internal/database"
)

// runPostMetrics saves made-up numbers for a post the development stand-in
// "published" (the old `pnpm simulate:post-metrics`), so the Analytics page
// and "Review performance" can be tried before any platform gives real
// ones. Labeled "Simulated (development)" wherever they show. A post to a
// real account is refused (its numbers come from its platform), and so is
// any number its platform doesn't have.
//
// Run from core/: go run ./cmd/simulate post-metrics <publish job id> views=120 reactions=8 ...
func runPostMetrics(args []string) error {
	if len(args) < 2 {
		return errors.New(analytics.SimulateUsage)
	}
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	// The guard first: this writes made-up numbers into the database.
	if reason := reasonNotToRun(cfg); reason != "" {
		return errors.New("refusing to run (this writes made-up numbers into the database): " + reason)
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	_, refusal, err := analytics.SimulatePostMetrics(ctx, pool, args[0], args[1:], !cfg.IsProduction())
	if err != nil {
		return err
	}
	if refusal != "" {
		return errors.New(refusal)
	}
	values, _ := analytics.ReadMetricArguments(args[1:])
	var saved []string
	for _, value := range values {
		saved = append(saved, value.Column+"="+strconv.FormatInt(value.Value, 10))
	}
	fmt.Printf("Saved simulated numbers (%s). See them on %s/cofounder/analytics\n", strings.Join(saved, " "), cfg.AppURL)
	return nil
}
