// Command simulate brings a customer's chat message into a company's Inbox
// through the development stand-in channel (the old `pnpm simulate:message`),
// so core can be tried without Telegram or Messenger. Each run is one new
// message from the customer named; the same name joins the same
// conversation. The running core answers it like a real chat (its reply is
// a file in .dev-messages/).
//
// It writes to the database directly, so it refuses to run outside
// development or against a database that isn't on this computer.
//
// Run from core/: go run ./cmd/simulate message <owner email> "<customer name>" "<message>"
package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/config"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

const usage = `usage: go run ./cmd/simulate message <owner email> "<customer name>" "<message>"`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 4 || args[0] != "message" || strings.TrimSpace(args[3]) == "" {
		return errors.New(usage)
	}
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	if reason := reasonNotToRun(cfg); reason != "" {
		return errors.New("refusing to run (this writes a made-up customer message): " + reason)
	}
	box, err := secure.NewBox(cfg.DataEncryptionKey)
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	company, name, err := ownersCompany(ctx, pool, args[1])
	if err != nil {
		return err
	}
	saved, err := saveMessage(ctx, pool, box, company, args[2], args[3])
	if err != nil {
		return err
	}
	fmt.Printf("Saved a message for %q. A running core answers it in a moment (see .dev-messages/).\n", name)
	if !saved {
		fmt.Println("(The same message was saved before: nothing new.)")
	}
	return nil
}

// reasonNotToRun: development only, and only a database on this computer.
func reasonNotToRun(cfg config.Config) string {
	if cfg.IsProduction() {
		return "ANSA_ENV is production"
	}
	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil || (parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1") {
		return "DATABASE_URL doesn't point at localhost or 127.0.0.1"
	}
	return ""
}

// ownersCompany is the company of a confirmed, active owner, by their address.
func ownersCompany(ctx context.Context, pool *database.Pool, email string) (tenant.CompanyID, string, error) {
	const statement = `
		-- cross-company: a development tool finds a company by its owner's address, as ansa's operator scripts do.
		SELECT companies.id, companies.name FROM users
		JOIN companies ON companies.id = users.company_id
		WHERE users.email = $1 AND users.role = 'owner' AND users.email_verified = true AND users.deactivated_at IS NULL`
	var id, name string
	err := pool.QueryRow(ctx, statement, strings.ToLower(strings.TrimSpace(email))).Scan(&id, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return tenant.CompanyID{}, "", errors.New("no confirmed, active owner has that address")
	}
	if err != nil {
		return tenant.CompanyID{}, "", err
	}
	company, err := tenant.FromTrustedSource(id)
	return company, name, err
}

// saveMessage saves the stand-in customer's message (the contact is the
// name, as the old standInContact) and queues the assistant's reply.
func saveMessage(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, customer, text string) (bool, error) {
	name := plaintext.SingleLine(customer)
	if utf8.RuneCountInString(name) > 200 {
		name = string([]rune(name)[:200])
	}
	if name == "" {
		name = "Stand-in customer"
	}
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) > 4000 {
		text = string([]rune(text)[:4000])
	}
	id, err := conversations.NewID()
	if err != nil {
		return false, err
	}
	body, err := box.Encrypt(text, conversations.MessageContext(company, id))
	if err != nil {
		return false, err
	}
	contact := conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: strings.ToLower(name), DisplayName: &name}
	turn, err := conversations.InsertCustomerMessage(ctx, pool, company, contact, conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: "stand-in-" + id})
	if err != nil || turn == nil {
		return false, err
	}
	return true, conversations.QueueReply(ctx, pool, turn)
}
