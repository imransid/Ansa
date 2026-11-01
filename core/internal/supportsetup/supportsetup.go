// Package supportsetup is Settings → "Phone, email and documents" (the old
// /setup page, services/setup.ts, db/company-settings.ts): the company's
// reply-to address, the support addresses its customers write to, and the
// checklist of what is left to set up. Owners change it; members read it.
// The forwarding address, the last email and the phone lines come from
// [channels]; the documents from [documents].
package supportsetup

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Overview is what the page reads besides channels and documents.
type Overview struct {
	ReplyToEmail     *string  `json:"replyToEmail"`
	SupportAddresses []string `json:"supportAddresses"`
	// For the checklist.
	ActiveCategories        int `json:"activeCategories"`
	Members                 int `json:"members"`
	PeopleWithoutCategories int `json:"peopleWithoutCategories"`
	Documents               int `json:"documents"`
}

// Read reads the company's overview.
func Read(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (Overview, error) {
	overview := Overview{SupportAddresses: []string{}}
	const counts = `
		SELECT companies.reply_to_email,
			(SELECT count(*) FROM categories WHERE company_id = $1 AND archived_at IS NULL),
			(SELECT count(*) FROM users WHERE company_id = $1 AND deactivated_at IS NULL),
			(SELECT count(*) FROM users WHERE company_id = $1 AND email_verified AND deactivated_at IS NULL
				AND NOT EXISTS (SELECT 1 FROM user_categories AS links
					JOIN categories ON categories.company_id = links.company_id AND categories.id = links.category_id
					WHERE links.company_id = $1 AND links.user_id = users.id AND categories.archived_at IS NULL)),
			(SELECT count(*) FROM company_documents WHERE company_id = $1)
		FROM companies WHERE companies.id = $1`
	err := pool.QueryRow(ctx, counts, company.String()).Scan(&overview.ReplyToEmail, &overview.ActiveCategories, &overview.Members, &overview.PeopleWithoutCategories, &overview.Documents)
	if err != nil {
		return Overview{}, err
	}
	rows, err := pool.Query(ctx, `SELECT address FROM inbound_addresses WHERE company_id = $1 ORDER BY address`, company.String())
	if err != nil {
		return Overview{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var address string
		if err := rows.Scan(&address); err != nil {
			return Overview{}, err
		}
		overview.SupportAddresses = append(overview.SupportAddresses, address)
	}
	return overview, rows.Err()
}

// IsAnsaAddress: one of ansa's own addresses (EMAIL_FROM, or anything on
// the forwarding domain): never a company's reply-to or support address.
func IsAnsaAddress(address, emailFrom, forwardingDomain string) bool {
	address = strings.ToLower(address)
	return (emailFrom != "" && address == strings.ToLower(emailFrom)) || strings.HasSuffix(address, "@"+strings.ToLower(forwardingDomain))
}

// SetReplyTo sets (or, with "", clears) the Reply-To of customer emails:
// cleared, replies go to the company's forwarding address.
func SetReplyTo(ctx context.Context, pool *database.Pool, company tenant.CompanyID, address string) error {
	_, err := pool.Exec(ctx, `UPDATE companies SET reply_to_email = NULLIF($2, '') WHERE id = $1`, company.String(), address)
	return err
}

// AddSupportAddress lists an address the company's customers write to: it
// is shown, and used to skip mail from the company itself; it never decides
// where email goes (only the forwarding address does). False: listed already
// (unique per company; another company listing it changes nothing here).
func AddSupportAddress(ctx context.Context, pool *database.Pool, company tenant.CompanyID, address string) (bool, error) {
	_, err := pool.Exec(ctx, `INSERT INTO inbound_addresses (company_id, address) VALUES ($1, $2)`, company.String(), address)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return false, nil
	}
	return err == nil, err
}

// RemoveSupportAddress takes one address off the list. False: not listed.
func RemoveSupportAddress(ctx context.Context, pool *database.Pool, company tenant.CompanyID, address string) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM inbound_addresses WHERE company_id = $1 AND address = $2`, company.String(), address)
	return tag.RowsAffected() == 1, err
}
