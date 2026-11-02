package tickets

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// RetitleAfterCallWithin gives an open request that ansa opened during a
// call the subject of that call's note, written once the call ended (the
// whole call, not just its first words), unless its subject was changed
// before, by a person or by an earlier note: one history row, by the app.
func RetitleAfterCallWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketID, subject string) error {
	const update = `
		UPDATE tickets SET subject = $3
		WHERE company_id = $1 AND id = $2 AND status = 'open' AND subject <> $3
			AND NOT EXISTS (SELECT 1 FROM ticket_activity WHERE company_id = $1 AND ticket_id = $2 AND kind = 'subject_changed')`
	tag, err := tx.Exec(ctx, update, company.String(), ticketID, subject)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	return recordChangeWithin(ctx, tx, company, ticketID, "subject_changed", "", "", nil)
}
