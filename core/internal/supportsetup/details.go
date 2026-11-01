package supportsetup

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// LastEmail is what became of the newest email that reached the company's
// forwarding address (Setup shows it: did forwarding work?).
type LastEmail struct {
	ReceivedAt    time.Time `json:"receivedAt"`
	Status        string    `json:"status"`
	IgnoredReason *string   `json:"ignoredReason"`
	TicketNumber  *int      `json:"ticketNumber"`
	Stuck         bool      `json:"stuck"`
}

// ReadLastEmail reads it (nil: none arrived yet).
func ReadLastEmail(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (*LastEmail, error) {
	const statement = `
		SELECT inbound_emails.received_at, inbound_emails.status::text, inbound_emails.ignored_reason, tickets.ticket_number,
			(inbound_emails.status = 'received' AND inbound_emails.received_at < now() - interval '15 minutes')
				OR (inbound_emails.status = 'processing' AND inbound_emails.processing_started_at < now() - interval '15 minutes')
		FROM inbound_emails
		LEFT JOIN tickets ON tickets.company_id = inbound_emails.company_id AND tickets.id = inbound_emails.ticket_id
		WHERE inbound_emails.company_id = $1
		ORDER BY inbound_emails.received_at DESC, inbound_emails.id DESC LIMIT 1`
	var e LastEmail
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&e.ReceivedAt, &e.Status, &e.IgnoredReason, &e.TicketNumber, &e.Stuck)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &e, err
}

// CheckCompanyName cleans a company's name: 2-100 characters, one line.
// It is also the sender name of every customer email ("<name> via ansa").
func CheckCompanyName(name string) (string, string) {
	name = strings.TrimSpace(name)
	switch length := utf8.RuneCountInString(name); {
	case length < 2:
		return "", "Company name must be at least 2 characters"
	case length > 100:
		return "", "Company name must be at most 100 characters"
	case strings.IndexFunc(name, unicode.IsControl) >= 0:
		return "", "Company name can't contain line breaks or other control characters"
	}
	return name, ""
}

// SaveCompanyName renames the company (owners: the role read again under
// the company row lock). Returns settings.Saved or why not.
func SaveCompanyName(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, name string) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE companies SET name = $2 WHERE id = $1`, company.String(), name)
		return err
	})
}
