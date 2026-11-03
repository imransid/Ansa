package comments

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// AlertDetails is what the owners' alert about a comment says: who, whether
// ansa's public note and the holding reply in Messenger reached them, and
// where to look (their conversation, else the request). Never the comment.
type AlertDetails struct {
	CommenterName *string
	PublicSent    bool
	PrivateSent   bool
	// The Messenger conversation the private reply opened ("" = none).
	ConversationID string
	RequestNumber  int
}

// ReadAlertDetails reads one comment's alert details (ErrNotFound: not this company's).
func ReadAlertDetails(ctx context.Context, pool *database.Pool, company tenant.CompanyID, commentRowID string) (AlertDetails, error) {
	const statement = `
		SELECT page_comments.commenter_name, COALESCE(page_comments.public_reply_status = 'sent', false),
			COALESCE(page_comments.private_message_status = 'sent', false), COALESCE(page_comments.conversation_id::text, ''),
			COALESCE(tickets.ticket_number, 0)
		FROM page_comments
		LEFT JOIN tickets ON tickets.id = page_comments.ticket_id AND tickets.company_id = page_comments.company_id
		WHERE page_comments.company_id = $1 AND page_comments.id = $2`
	var d AlertDetails
	err := pool.QueryRow(ctx, statement, company.String(), commentRowID).Scan(&d.CommenterName, &d.PublicSent, &d.PrivateSent, &d.ConversationID, &d.RequestNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}
