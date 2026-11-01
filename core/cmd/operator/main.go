// Command operator holds ansa's operator commands (the old pnpm
// link:phone-line, unlink:phone-line, show:forwarding-address,
// replace:forwarding-address and telegram:webhook). They run by hand, in
// development and against production. A company is found ONLY by the
// address of a confirmed, active owner; a command that changes something
// prints the company first and changes nothing without --yes. Output names
// the company and what changed: never a token, a secret or a customer's
// details.
//
// Settings: the environment, then ../.env.core for what it doesn't set, so
// DATABASE_URL="<direct url>" on the command line reaches that database.
// Run from core/: go run ./cmd/operator <command> ... Every command, what
// it changes and its guards: docs/backend/modules/commands.md.
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
)

// settingsFile is core's settings, seen from core/ (the Makefile's folder).
const settingsFile = "../.env.core"

const usagePrefix = "usage: go run ./cmd/operator "

// command is one operator command.
type command struct {
	// What to type after the command (it starts with the command's name).
	usage string
	// fits: the arguments have the usage's shape (checked before any setting is read).
	fits func(args []string) bool
	run  func(ctx context.Context, w *world, args []string) error
}

// world is what every command gets.
type world struct {
	cfg  config.Config
	pool *database.Pool
	out  io.Writer
}

// allCommands is every command by name (a function, not a variable: the
// commands' own files would otherwise make an initialization loop).
func allCommands() map[string]command {
	return map[string]command{
		"link-phone-line":            linkPhoneLineCommand,
		"unlink-phone-line":          unlinkPhoneLineCommand,
		"show-forwarding-address":    showForwardingAddressCommand,
		"replace-forwarding-address": replaceForwardingAddressCommand,
		"telegram-webhook":           telegramWebhookCommand,
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

// run checks the arguments, then the settings, then runs the command.
func run(ctx context.Context, args []string, getenv config.Getenv, out io.Writer) error {
	if len(args) == 0 {
		return errors.New(everyUsage())
	}
	chosen, known := allCommands()[args[0]]
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
	// The pool connects on its first query: telegram-webhook never makes one.
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	return chosen.run(ctx, &world{cfg: cfg, pool: pool, out: out}, args[1:])
}

func everyUsage() string {
	var lines []string
	for _, c := range allCommands() {
		lines = append(lines, "  go run ./cmd/operator "+c.usage)
	}
	sort.Strings(lines)
	return "usage:\n" + strings.Join(lines, "\n")
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

// plain: count filled arguments, and no --yes (the command changes nothing).
func plain(count int) func([]string) bool {
	return func(args []string) bool {
		_, confirmed := commands.SplitConfirm(args)
		return !confirmed && confirmable(count)(args)
	}
}

// confirmable: count filled arguments once --yes (anywhere) is out.
func confirmable(count int) func([]string) bool {
	return func(args []string) bool {
		values, _ := commands.SplitConfirm(args)
		if len(values) != count {
			return false
		}
		for _, value := range values {
			if strings.TrimSpace(value) == "" {
				return false
			}
		}
		return true
	}
}
