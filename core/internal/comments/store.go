package comments

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/tenant"
)

// reader is a pool or a transaction.
type reader interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// comment is one saved comment, as the answering job reads it.
type comment struct {
	ID, ConnectionID, PageID, PostID, CommentID, CommenterID string
	CommenterName                                            *string
	TextEncrypted                                            string
	CommentedAt                                              time.Time
	Status                                                   string
	DecidedAt, DeliveryStartedAt                             *time.Time
	PublicEncrypted, PublicStatus                            *string
	PrivateEncrypted, PrivateStatus                          *string
	TicketID                                                 *string
}

// readComment is one comment of the company (nil: not this company's).
func readComment(ctx context.Context, db reader, company tenant.CompanyID, id string) (*comment, error) {
	const statement = `
		SELECT id::text, connection_id::text, page_id, post_id, comment_id, commenter_id, commenter_name, text_encrypted, commented_at,
			status, decided_at, delivery_started_at, public_reply_encrypted, public_reply_status,
			private_message_encrypted, private_message_status, ticket_id::text
		FROM page_comments WHERE company_id = $1 AND id = $2`
	var c comment
	err := db.QueryRow(ctx, statement, company.String(), id).Scan(&c.ID, &c.ConnectionID, &c.PageID, &c.PostID, &c.CommentID, &c.CommenterID,
		&c.CommenterName, &c.TextEncrypted, &c.CommentedAt, &c.Status, &c.DecidedAt, &c.DeliveryStartedAt,
		&c.PublicEncrypted, &c.PublicStatus, &c.PrivateEncrypted, &c.PrivateStatus, &c.TicketID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// isSending: a part is saved to go out ("sending").
func isSending(status *string) bool {
	return status != nil && *status == PartSending
}

// switches is what decides whether a company answers comments on one Page.
type switches struct {
	// A business (one person has no comments to answer: kind "personal").
	Business bool
	// An owner switched comments on.
	On bool
	// The Page is connected here, and allowed to answer comments
	// (pages_read_user_content and pages_manage_engagement, or a
	// development stand-in); allowed to send Messenger messages
	// (pages_messaging, or a stand-in).
	PageConnected, PageAllowed, PageCanMessage, PageStandIn bool
}

// readSwitches reads the company's switches for one of its Pages.
func readSwitches(ctx context.Context, db reader, company tenant.CompanyID, connectionID string) (switches, error) {
	const statement = `
		SELECT companies.kind = 'business',
			COALESCE((SELECT comments_on FROM assistant_settings WHERE assistant_settings.company_id = companies.id), false),
			COALESCE(pages.status = 'connected', false),
			COALESCE(pages.is_stand_in OR ('pages_read_user_content' = ANY(pages.scopes) AND 'pages_manage_engagement' = ANY(pages.scopes)), false),
			COALESCE(pages.is_stand_in OR 'pages_messaging' = ANY(pages.scopes), false),
			COALESCE(pages.is_stand_in, false)
		FROM companies
		LEFT JOIN social_connections pages ON pages.company_id = companies.id AND pages.id = $2 AND pages.platform = 'facebook'
		WHERE companies.id = $1`
	var s switches
	err := db.QueryRow(ctx, statement, company.String(), connectionID).Scan(&s.Business, &s.On, &s.PageConnected, &s.PageAllowed, &s.PageCanMessage, &s.PageStandIn)
	return s, err
}

// skipNowReason is why the company doesn't answer comments on this Page
// now ("" = it does): switched off (or one person's account), the Page not
// connected or not allowed, or a package without comments.
func (s switches) skipNowReason(packageAnswersComments bool) string {
	switch {
	case !s.Business || !s.On:
		return SkipCommentsOff
	case !s.PageConnected || !s.PageAllowed:
		return SkipNotAllowed
	case !packageAnswersComments:
		return SkipPackage
	}
	return ""
}
