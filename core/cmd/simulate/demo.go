package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/accounts"
	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// demo makes the two demo accounts again from nothing, ready to show ansa on
// this laptop (docs/demo.md): a restaurant that takes orders, and one person
// whose phone is away. Each is signed up and set up through core's own
// functions (as the pages do), with stand-in Telegram, WhatsApp and Facebook
// accounts and the free "Claude Code on this computer" AI engine. Running it
// again deletes both demo accounts and everything they had first, so every
// rehearsal starts the same; "if-missing" (pnpm demo, at every start) makes
// them only when they aren't there, and keeps what a demo did.
var demoTool = tool{
	usage: "demo [if-missing]",
	does:  "deletes and makes the two demo accounts again",
	fits:  func(args []string) bool { return len(args) == 0 || (len(args) == 1 && args[0] == "if-missing") },
	run:   runDemo,
}

// The demo accounts' fixed addresses and password (development only: the
// tool refuses production and any database that isn't on this computer).
const (
	demoBusinessEmail = "business@demo.ansa.test"
	demoPersonEmail   = "rafa@demo.ansa.test"
	demoPassword      = "ansa-demo-2026"
)

// demoAccount is one signed-up demo owner: their company and id.
type demoAccount struct {
	company tenant.CompanyID
	userID  string
}

func runDemo(ctx context.Context, w *world, args []string) error {
	if len(args) == 1 {
		there, err := demoAccountsThere(ctx, w)
		if err != nil || there {
			if there {
				printDemoLogins(w)
			}
			return err
		}
	}
	if err := deleteDemoAccounts(ctx, w); err != nil {
		return err
	}
	restaurant, err := signUpDemo(ctx, w, "Nadia Rahman", demoBusinessEmail)
	if err != nil {
		return err
	}
	if err := setUpRestaurant(ctx, w, restaurant); err != nil {
		return err
	}
	person, err := signUpDemo(ctx, w, "Rafa", demoPersonEmail)
	if err != nil {
		return err
	}
	if err := setUpPerson(ctx, w, person); err != nil {
		return err
	}
	printDemoLogins(w)
	return nil
}

// printDemoLogins says how to log in to the demo accounts and where to be
// the customer.
func printDemoLogins(w *world) {
	fmt.Fprintf(w.out, "\nThe demo is ready. Log in at %s/login (password %s):\n", w.cfg.AppURL, demoPassword)
	fmt.Fprintf(w.out, "  A restaurant, Shapla Kitchen:  %s\n", demoBusinessEmail)
	fmt.Fprintf(w.out, "  One person, Rafa:              %s\n", demoPersonEmail)
	fmt.Fprintf(w.out, "Be the customer at %s/settings/channels/practice-chat, and call at %s/settings/channels/practice-call.\n", w.cfg.AppURL, w.cfg.AppURL)
}

// demoAccountsThere: whether both demo accounts exist.
func demoAccountsThere(ctx context.Context, w *world) (bool, error) {
	const statement = `
		-- cross-company: the demo tool looks for its own demo accounts by their fixed addresses (development only).
		SELECT count(*) FROM users WHERE email = ANY($1) AND company_id IS NOT NULL`
	var count int
	err := w.pool.QueryRow(ctx, statement, []string{demoBusinessEmail, demoPersonEmail}).Scan(&count)
	return count == 2, err
}

// The demo's address domain: the demo accounts, Karim, and anyone a
// rehearsal signs up live (nadia+1@demo.ansa.test).
const demoDomain = "@demo.ansa.test"

// Whether a reset forgets every rate limit counter (a rehearsal's signups,
// logins and emails then don't count against the next one). The demo's own
// test keeps them: other packages' tests count on theirs in that database.
var demoForgetsRateLimits = true

// deleteDemoAccounts deletes every account on the demo's address domain with
// its company, everything in it and its stored files, and every rate limit
// counter, so each rehearsal starts the same (development only: the tool's
// guard refuses production and any database not on this computer).
func deleteDemoAccounts(ctx context.Context, w *world) error {
	const statement = `
		-- cross-company: the demo tool finds the companies of the accounts on its own address domain, to delete them (development only).
		SELECT DISTINCT company_id::text FROM users WHERE email LIKE '%' || $1`
	rows, err := w.pool.Query(ctx, statement, demoDomain)
	if err != nil {
		return err
	}
	companies, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, companyID := range companies {
		if _, err := w.pool.Exec(ctx, `DELETE FROM verifications WHERE value IN (SELECT id FROM users WHERE company_id = $1)`, companyID); err != nil {
			return err
		}
		if err := database.DeleteTestCompany(ctx, w.pool, companyID); err != nil {
			return err
		}
		for _, kind := range []string{"recordings", "documents", "media"} {
			if err := os.RemoveAll(filepath.Join(w.cfg.DevFolder, ".dev-files", kind, companyID)); err != nil {
				return err
			}
		}
	}
	if !demoForgetsRateLimits {
		return nil
	}
	_, err = w.pool.Exec(ctx, `DELETE FROM rate_limits`)
	return err
}

// signUpDemo signs a demo owner up through core's signup (the one place that
// decides a new person's company) and confirms the address, standing in for
// the emailed link (development only).
func signUpDemo(ctx context.Context, w *world, name, address string) (demoAccount, error) {
	run, err := conversations.NewID()
	if err != nil {
		return demoAccount{}, err
	}
	// Never real email, and a counter of this run's own (rehearsals don't use
	// up the hourly signups).
	service := &accounts.Service{Pool: w.pool, Secret: w.cfg.AuthSecret, AppURL: w.cfg.AppURL, Mail: &email.Sender{DevFolder: w.cfg.DevFolder},
		Limits: ratelimit.New(w.pool, w.cfg.AuthSecret), Log: logging.New(io.Discard)}
	message, err := service.SignUp(ctx, accounts.NewPerson{Name: name, Email: address, Password: demoPassword}, accounts.Request{IP: "demo-tool-" + run})
	if err != nil {
		return demoAccount{}, err
	}
	if message != "" {
		return demoAccount{}, commands.Refusal("Signing up " + address + " was refused: " + message)
	}
	const find = `
		-- cross-company: the demo tool finds the demo account it has just signed up, by its fixed address (development only).
		SELECT company_id::text, id FROM users WHERE email = $1`
	var companyID, userID string
	if err := w.pool.QueryRow(ctx, find, address).Scan(&companyID, &userID); err != nil {
		return demoAccount{}, err
	}
	company, err := tenant.FromTrustedSource(companyID)
	if err != nil {
		return demoAccount{}, err
	}
	if _, err := w.pool.Exec(ctx, `UPDATE users SET email_verified = true WHERE company_id = $1 AND id = $2`, companyID, userID); err != nil {
		return demoAccount{}, err
	}
	fmt.Fprintf(w.out, "Signed up %s.\n", address)
	return demoAccount{company: company, userID: userID}, nil
}

// saved turns a refused save ("not saved" outcomes, problems with fields)
// into the tool's refusal.
func saved(what, outcome string, err error) error {
	if err != nil {
		return err
	}
	if outcome != "saved" && outcome != "connected" && outcome != "created" {
		return commands.Refusal(fmt.Sprintf("The demo's %s wasn't saved (%s).", what, outcome))
	}
	return nil
}
