package whatsapp

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// number is the company a WhatsApp number's messages belong to, and its row.
type number struct {
	CompanyID tenant.CompanyID
	ID        string
}

// findNumber is the one company that has this number connected, or nil
// (none, or more than one: a number in two companies decides nothing).
func findNumber(ctx context.Context, pool *database.Pool, phoneNumberID string) (*number, error) {
	const statement = `
		-- cross-company: the phone number id Meta signed names the company, only when exactly one has it connected; ids only.
		SELECT company_id, id FROM whatsapp_numbers
		WHERE phone_number_id = $1 AND status = 'connected'
		LIMIT 2`
	found, err := numbers(ctx, pool, statement, phoneNumberID)
	if err != nil || len(found) != 1 {
		return nil, err
	}
	return &found[0], nil
}

// followAccountChange: Meta ended (or restored) the link to a business
// account, so each of its numbers that ansa has changes status, through its
// own company. A number an owner disconnected in ansa stays disconnected.
func followAccountChange(ctx context.Context, pool *database.Pool, wabaID, newStatus string) error {
	const statement = `
		-- cross-company: the business account id Meta signed names its numbers; ids only.
		SELECT company_id, id FROM whatsapp_numbers
		WHERE waba_id = $1 AND status IN ('connected', 'removed_in_whatsapp')
		LIMIT 20`
	found, err := numbers(ctx, pool, statement, wabaID)
	if err != nil {
		return err
	}
	const update = `
		UPDATE whatsapp_numbers SET status = $3, updated_at = now()
		WHERE company_id = $1 AND id = $2 AND status IN ('connected', 'removed_in_whatsapp')`
	for _, n := range found {
		if _, err := pool.Exec(ctx, update, n.CompanyID.String(), n.ID, newStatus); err != nil {
			return err
		}
	}
	return nil
}

func numbers(ctx context.Context, pool *database.Pool, statement, id string) ([]number, error) {
	rows, err := pool.Query(ctx, statement, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var found []number
	for rows.Next() {
		var company, row string
		if err := rows.Scan(&company, &row); err != nil {
			return nil, err
		}
		id, err := tenant.FromTrustedSource(company)
		if err != nil {
			return nil, err
		}
		found = append(found, number{CompanyID: id, ID: row})
	}
	return found, rows.Err()
}
