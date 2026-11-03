package comments

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// PageSize is how many comments one page of the list shows.
const PageSize = 50

// The deepest page the list goes to (as every list in ansa).
const maxPage = 10_000

// ErrNotFound: no such comment in this company.
var ErrNotFound = errors.New("comments: not this company's comment")

// Part is ansa's public reply as the page shows it.
type Part struct {
	Text   string `json:"text"`
	Status string `json:"status"`
}

// PrivatePart is ansa's private message, and the Messenger conversation it
// opened ("" when none: not sent, or Meta didn't name the commenter).
type PrivatePart struct {
	Text           string `json:"text"`
	Status         string `json:"status"`
	ConversationID string `json:"conversationId"`
}

// View is one comment as the screens show it.
type View struct {
	ID            string    `json:"id"`
	ReceivedAt    time.Time `json:"receivedAt"`
	CommenterName string    `json:"commenterName"`
	// The first 200 characters of the post, when ansa published it ("" otherwise).
	PostText string `json:"postText"`
	// The comment ("" when it can't be decrypted: Readable false).
	Text           string       `json:"text"`
	Readable       bool         `json:"readable"`
	Kind           string       `json:"kind"`
	Status         string       `json:"status"`
	SkipReason     string       `json:"skipReason"`
	PublicReply    *Part        `json:"publicReply"`
	PrivateMessage *PrivatePart `json:"privateMessage"`
	// The request a person follows up (0 = none).
	RequestNumber int `json:"requestNumber"`
}

// The columns every view reads, and how the post's text is found: the
// draft ansa published it from (the post itself is never stored).
const viewColumns = `
	page_comments.id::text, page_comments.received_at, COALESCE(page_comments.commenter_name, ''), page_comments.post_id,
	COALESCE((SELECT content_drafts.body FROM publish_jobs
		JOIN content_drafts ON content_drafts.id = publish_jobs.draft_id AND content_drafts.company_id = publish_jobs.company_id
		WHERE publish_jobs.company_id = page_comments.company_id AND publish_jobs.external_post_id = page_comments.post_id AND publish_jobs.status = 'published'
		ORDER BY publish_jobs.published_at DESC LIMIT 1), ''),
	page_comments.text_encrypted, COALESCE(page_comments.kind, ''), page_comments.status, COALESCE(page_comments.skip_reason, ''),
	page_comments.public_reply_encrypted, page_comments.public_reply_status,
	page_comments.private_message_encrypted, page_comments.private_message_status, COALESCE(page_comments.conversation_id::text, ''),
	COALESCE(tickets.ticket_number, 0)`

// ClampPage is the page the list shows for a page number asked (1 to 10,000).
func ClampPage(page int) int {
	return min(max(page, 1), maxPage)
}

// List is one page of the company's comments, newest first, and how many
// there are in all.
func List(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, page int) ([]View, int, error) {
	page = ClampPage(page)
	statement := `
		SELECT ` + viewColumns + `
		FROM page_comments
		LEFT JOIN tickets ON tickets.id = page_comments.ticket_id AND tickets.company_id = page_comments.company_id
		WHERE page_comments.company_id = $1
		ORDER BY page_comments.received_at DESC, page_comments.id DESC
		LIMIT $2 OFFSET $3`
	rows, err := pool.Query(ctx, statement, company.String(), PageSize, (page-1)*PageSize)
	if err != nil {
		return nil, 0, err
	}
	views := []View{}
	for rows.Next() {
		view, err := scanView(rows, box, company)
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		views = append(views, view)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var total int
	err = pool.QueryRow(ctx, `SELECT count(*) FROM page_comments WHERE company_id = $1`, company.String()).Scan(&total)
	return views, total, err
}

// ReadOne is one comment of the company (ErrNotFound: not this company's).
func ReadOne(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, id string) (*View, error) {
	statement := `
		SELECT ` + viewColumns + `
		FROM page_comments
		LEFT JOIN tickets ON tickets.id = page_comments.ticket_id AND tickets.company_id = page_comments.company_id
		WHERE page_comments.company_id = $1 AND page_comments.id = $2`
	rows, err := pool.Query(ctx, statement, company.String(), id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	view, err := scanView(rows, box, company)
	return &view, err
}

// scanView reads one row: the texts decrypted for this company and
// comment, the parts shown once the comment is no longer being answered.
func scanView(rows pgx.Rows, box *secure.Box, company tenant.CompanyID) (View, error) {
	var v View
	var postID, text string
	var publicText, publicStatus, privateText, privateStatus *string
	var conversationID string
	if err := rows.Scan(&v.ID, &v.ReceivedAt, &v.CommenterName, &postID, &v.PostText, &text, &v.Kind, &v.Status, &v.SkipReason,
		&publicText, &publicStatus, &privateText, &privateStatus, &conversationID, &v.RequestNumber); err != nil {
		return v, err
	}
	if postID == PracticePostID {
		v.PostText = PracticePostText
	}
	v.PostText = cutRunes(v.PostText, 200)
	if readable, err := box.Decrypt(text, TextContext(company, v.ID, "text")); err == nil {
		v.Text, v.Readable = readable, true
	}
	// A discarded reply never went: Discard is shown as a skipped comment.
	if v.SkipReason == SkipDiscarded {
		v.SkipReason = ""
	}
	if v.Status == StatusNew {
		return v, nil
	}
	if shown := shownPart(box, company, v.ID, "public_reply", publicText, publicStatus); shown != nil {
		v.PublicReply = shown
	}
	if shown := shownPart(box, company, v.ID, "private_message", privateText, privateStatus); shown != nil {
		v.PrivateMessage = &PrivatePart{Text: shown.Text, Status: shown.Status, ConversationID: conversationID}
	}
	return v, nil
}

// shownPart is a part as the page shows it: none when there isn't one or
// it was discarded; its text "" when it can't be decrypted.
func shownPart(box *secure.Box, company tenant.CompanyID, commentRowID, field string, encrypted, status *string) *Part {
	if encrypted == nil || status == nil || *status == PartDiscarded || *status == PartSending {
		return nil
	}
	text, err := box.Decrypt(*encrypted, TextContext(company, commentRowID, field))
	if err != nil {
		text = ""
	}
	return &Part{Text: text, Status: *status}
}
