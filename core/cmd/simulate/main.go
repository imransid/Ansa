// Command simulate holds ansa's development tools (the old pnpm
// simulate:*, telegram:poll, seed:tickets and try:brain): made-up
// customers, calls, emails and numbers, to try core by hand before the real
// services exist. Each tool refuses production and any database that isn't
// on this computer (they write made-up rows), and the tools that send
// webhooks send them only to a core on this computer.
//
// Settings: the environment, then ../.env.core for what it doesn't set.
// Run from core/: go run ./cmd/simulate <tool> ... Every tool, what it
// changes and its guards: docs/backend/modules/commands.md.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"ansa/core/internal/commands"
	"ansa/core/internal/config"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
)

// settingsFile is core's settings, seen from core/ (the Makefile's folder).
const settingsFile = "../.env.core"

const usagePrefix = "usage: go run ./cmd/simulate "

// tool is one development tool.
type tool struct {
	// What to type after the command (it starts with the tool's name).
	usage string
	// What it writes or sends, for its refusal ("writes a made-up call").
	does string
	// fits: the arguments have the usage's shape (checked before any setting is read).
	fits func(args []string) bool
	run  func(ctx context.Context, w *world, args []string) error
}

// world is what every tool gets.
type world struct {
	cfg  config.Config
	pool *database.Pool
	box  *secure.Box
	out  io.Writer
}

// allTools is every tool by name (a function, not a variable: the tools'
// own files would otherwise make an initialization loop).
func allTools() map[string]tool {
	return map[string]tool{
		"message":        messageTool,
		"post-metrics":   postMetricsTool,
		"vapi-call":      vapiCallTool,
		"vapi-tool-call": vapiToolCallTool,
		"solved-call":    solvedCallTool,
		"try-brain":      tryBrainTool,
		"inbound-email":  inboundEmailTool,
		"email-bounce":   emailBounceTool,
		"telegram":       telegramTool,
		"telegram-poll":  telegramPollTool,
		"messenger":      messengerTool,
		"whatsapp":       whatsappTool,
		"seed-tickets":   seedTicketsTool,
		"demo":           demoTool,
	}
}

func main() {
	err := config.FillFromFile(settingsFile)
	if err == nil {
		err = run(context.Background(), os.Args[1:], os.Getenv, os.Stdout)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// run checks the arguments, then the settings and the guard, then runs the tool.
func run(ctx context.Context, args []string, getenv config.Getenv, out io.Writer) error {
	if len(args) == 0 {
		return errors.New(everyUsage())
	}
	chosen, known := allTools()[args[0]]
	if !known {
		return errors.New(everyUsage())
	}
	if !chosen.fits(args[1:]) {
		return errors.New(usagePrefix + chosen.usage)
	}
	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	// The guard first: every tool writes or sends something made up.
	if reason := commands.ReasonNotToRun(cfg); reason != "" {
		return fmt.Errorf("refusing to run (this %s): %s", chosen.does, reason)
	}
	box, err := secure.NewBox(cfg.DataEncryptionKey)
	if err != nil {
		return err
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	return chosen.run(ctx, &world{cfg: cfg, pool: pool, box: box, out: out}, args[1:])
}

func everyUsage() string {
	var lines []string
	for _, t := range allTools() {
		lines = append(lines, "  go run ./cmd/simulate "+t.usage)
	}
	sort.Strings(lines)
	return "usage (development only):\n" + strings.Join(lines, "\n")
}

// owner is the company of a confirmed, active owner's address, printed first.
func (w *world) owner(ctx context.Context, email string) (commands.Company, error) {
	company, err := commands.FindOwnersCompany(ctx, w.pool, email)
	if err != nil {
		return commands.Company{}, err
	}
	fmt.Fprintln(w.out, commands.Describe(company))
	return company, nil
}

// Shapes of arguments the tools check before reading any setting.
func exactly(count int) func([]string) bool {
	return func(args []string) bool { return len(args) == count && allFilled(args) }
}

func between(least, most int) func([]string) bool {
	return func(args []string) bool { return len(args) >= least && len(args) <= most && allFilled(args) }
}

func allFilled(args []string) bool {
	for _, arg := range args {
		if strings.TrimSpace(arg) == "" {
			return false
		}
	}
	return true
}
