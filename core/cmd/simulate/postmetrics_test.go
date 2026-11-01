package main

import (
	"strings"
	"testing"

	"ansa/core/internal/analytics"
	"ansa/core/internal/config"
)

// The commands write made-up rows into the database: only in development,
// and only into a database on this computer.
func TestTheSimulationsRunOnlyOnALocalDevelopmentDatabase(t *testing.T) {
	local := "postgres://ansa@localhost:5432/ansa"
	if reasonNotToRun(config.Config{Environment: "production", DatabaseURL: local}) == "" {
		t.Fatal("production is refused")
	}
	if reasonNotToRun(config.Config{Environment: "development", DatabaseURL: "postgres://ansa@db.example.com/ansa"}) == "" {
		t.Fatal("a database elsewhere is refused")
	}
	if reasonNotToRun(config.Config{Environment: "development", DatabaseURL: local}) != "" {
		t.Fatal("a local development database is fine")
	}
	if err := run([]string{"post-metrics"}); err == nil || err.Error() != analytics.SimulateUsage || !strings.Contains(err.Error(), "video_views=<number>") {
		t.Fatalf("without a post and numbers, the usage: %v", err)
	}
}
