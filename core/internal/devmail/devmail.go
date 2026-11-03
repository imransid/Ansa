// Package devmail is the development mailbox (for trying and showing ansa on
// the laptop, docs/demo.md): the emails ansa "sent" here, read back from the
// folder the stand-in outbox writes them to (internal/email/outbox.go: one
// HTML page per email in <DevFolder>/.dev-emails). Only an email's From,
// To, Subject and plain text are read, never its HTML. Development only:
// production sends real email and has no such folder (the API refuses it).
package devmail

import (
	"context"
	"errors"
	"html"
	"io/fs"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Mail is one email as the outbox wrote it.
type Mail struct {
	// The file's name: the email's id here.
	ID      string    `json:"id"`
	At      time.Time `json:"at"`
	From    string    `json:"from"`
	To      string    `json:"to"`
	Subject string    `json:"subject"`
	Text    string    `json:"text"`
	// The send's idempotency key, which names its records
	// ("ticket-solved-<outgoing email id>", "verify-email-<user id>-...").
	key string
}

// The most files one look reads (the folder only grows on a laptop).
const filesRead = 2000

var (
	headerLine = regexp.MustCompile(`<div><strong>(From|To|Subject):</strong> (.*)</div>`)
	textPart   = regexp.MustCompile(`(?s)<pre>(.*)</pre>`)
	fileName   = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-([A-Za-z0-9_-]+)\.html$`)
	uuid       = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
)

// ToAddress keeps the emails to one address (lower case).
func ToAddress(wanted string) func(Mail) bool {
	return func(email Mail) bool { return address(email.To) == wanted }
}

// Read is the newest emails in the folder that keep keeps, at most limit,
// newest first. No folder yet: none.
func Read(folder string, keep func(Mail) bool, limit int) ([]Mail, error) {
	entries, err := os.ReadDir(folder)
	if errors.Is(err, fs.ErrNotExist) {
		return []Mail{}, nil
	}
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && fileName.MatchString(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	// The name starts with the time: newest last, read from the end.
	sort.Strings(names)
	found := []Mail{}
	for i := len(names) - 1; i >= 0 && i >= len(names)-filesRead && len(found) < limit; i-- {
		email, ok := readFile(folder, names[i])
		if ok && keep(email) {
			found = append(found, email)
		}
	}
	return found, nil
}

// readFile reads one outbox page (false: not one the outbox wrote).
func readFile(folder, name string) (Mail, bool) {
	page, err := os.ReadFile(filepath.Join(folder, name))
	if err != nil {
		return Mail{}, false
	}
	parts := fileName.FindStringSubmatch(name)
	at, err := time.Parse("2006-01-02T15-04-05.000Z", parts[1])
	if err != nil {
		return Mail{}, false
	}
	email := Mail{ID: name, At: at, key: parts[2]}
	for _, line := range headerLine.FindAllStringSubmatch(string(page), 3) {
		value := html.UnescapeString(line[2])
		switch line[1] {
		case "From":
			email.From = value
		case "To":
			email.To = value
		case "Subject":
			email.Subject = value
		}
	}
	if text := textPart.FindStringSubmatch(string(page)); text != nil {
		email.Text = strings.TrimSpace(html.UnescapeString(text[1]))
	}
	return email, email.To != ""
}

// address is the email address of a To line ("Ana <ana@x.example>" or a
// bare address), in lower case ("" when it holds none).
func address(to string) string {
	parsed, err := mail.ParseAddress(to)
	if err != nil {
		return strings.ToLower(strings.TrimSpace(to))
	}
	return strings.ToLower(parsed.Address)
}

// OfCompany keeps the emails sent for the company: their idempotency key
// names one of its people (account emails, alerts to owners), its customer
// emails or its assignment emails' jobs. An email of an earlier demo reset
// or another company names none of them.
func OfCompany(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (func(Mail) bool, error) {
	const statement = `
		SELECT id FROM users WHERE company_id = $1
		UNION ALL SELECT id::text FROM outgoing_emails WHERE company_id = $1
		UNION ALL SELECT id::text FROM core_jobs WHERE company_id = $1 AND kind = 'ticket.assigned'`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return func(email Mail) bool {
		for _, id := range keyIDs(email.key) {
			if ids[id] {
				return true
			}
		}
		return false
	}, nil
}

// keyIDs is the ids an idempotency key holds: its uuids, and its other
// parts long enough to be an account's id (a kind's words are short).
func keyIDs(key string) []string {
	ids := uuid.FindAllString(key, -1)
	for _, part := range strings.Split(uuid.ReplaceAllString(key, "-"), "-") {
		if len(part) >= 16 {
			ids = append(ids, part)
		}
	}
	return ids
}
