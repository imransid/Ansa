package messenger

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// page is the company a Page's messages belong to, and its connection.
type page struct {
	CompanyID    tenant.CompanyID
	ConnectionID string
}

// findPage is the one company that has this Facebook Page connected, or nil
// (none, or more than one: a Page in two companies decides nothing).
func findPage(ctx context.Context, pool *database.Pool, pageID string) (*page, error) {
	const statement = `
		-- cross-company: the Page id Meta signed names the company, only when exactly one has it; ids only.
		SELECT company_id, id FROM social_connections
		WHERE platform = 'facebook' AND external_account_id = $1 AND status = 'connected'
		LIMIT 2`
	rows, err := pool.Query(ctx, statement, pageID)
	if err != nil {
		return nil, err
	}
	var found []page
	for rows.Next() {
		var company, connection string
		if err := rows.Scan(&company, &connection); err != nil {
			return nil, err
		}
		id, err := tenant.FromTrustedSource(company)
		if err != nil {
			return nil, err
		}
		found = append(found, page{CompanyID: id, ConnectionID: connection})
	}
	if err := rows.Err(); err != nil || len(found) != 1 {
		return nil, err
	}
	return &found[0], nil
}

// contactNeedsName: the conversation's contact has no name yet.
func contactNeedsName(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) (bool, error) {
	const statement = `
		SELECT contacts.display_name IS NULL FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2`
	var needs bool
	err := pool.QueryRow(ctx, statement, company.String(), conversationID).Scan(&needs)
	return needs, err
}

// fillNameOnce sets the contact's name only while it has none.
func fillNameOnce(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID, name string) error {
	const statement = `
		UPDATE contacts SET display_name = $3
		WHERE company_id = $1 AND display_name IS NULL
			AND id = (SELECT contact_id FROM conversations WHERE company_id = $1 AND id = $2)`
	_, err := pool.Exec(ctx, statement, company.String(), conversationID, name)
	return err
}
