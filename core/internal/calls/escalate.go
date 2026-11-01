package calls

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// "Escalate to a ticket" on a call the AI marked solved: a teammate saw the
// AI got it wrong. The AI's verdict never changes (ai_outcome and
// ai_reason_code stay), so its accuracy can still be counted: solved calls
// with escalated_at.

// Escalate makes the call's request in ONE transaction: an UPDATE claims
// the call (this company, decided "solved", not escalated, no request) and
// records who and when, then the request is numbered ("escalated" history
// row, then routing). The call row is locked before numbering takes the
// company row, as when saving a decision. Returns the request's number, or
// 0 when the call can't be escalated (someone may have just done it).
func Escalate(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, userID, callID, categoryID, note string) (int, error) {
	var number int
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		const claim = `
			UPDATE calls SET escalated_by_user_id = $3, escalated_at = now(), updated_at = now()
			WHERE company_id = $1 AND id = $2 AND analysis_status = 'decided' AND ai_outcome = 'solved' AND escalated_at IS NULL
				AND NOT EXISTS (SELECT 1 FROM tickets WHERE tickets.company_id = $1 AND tickets.call_id = $2)
			RETURNING caller_number, ai_issue_encrypted`
		var caller, issueSealed *string
		err := tx.QueryRow(ctx, claim, company.String(), callID, userID).Scan(&caller, &issueSealed)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		// The AI's short summary and the teammate's note, never the
		// transcript nor the sentence the AI quoted.
		var parts []string
		if issue, _ := open(box, issueSealed, "call-ai-issue:"+company.String()+":"+callID); issue != nil {
			parts = append(parts, *issue)
		}
		parts = append(parts, "Escalated by a teammate: the AI marked this call solved, but it needs a person.")
		if note != "" {
			parts = append(parts, "What still needs doing: "+note)
		}
		phone := ""
		if caller != nil {
			phone = *caller
		}
		ticketID, err := tickets.CreateCallTicketWithin(ctx, tx, company, tickets.NewCallRequest{Subject: fallbackSubject,
			Description: strings.Join(parts, "\n\n"), CategoryID: categoryID, CustomerPhone: phone, CallID: callID, EscalatedBy: userID})
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT ticket_number FROM tickets WHERE company_id = $1 AND id = $2`, company.String(), ticketID).Scan(&number)
	})
	return number, err
}

// Lookup is one knowledge search the voice assistant made during a call:
// the articles its answer held (a nil title: deleted since).
type Lookup struct {
	ID       string          `json:"id"`
	At       time.Time       `json:"at"`
	Articles []LookupArticle `json:"articles"`
}

// LookupArticle is one article of a lookup.
type LookupArticle struct {
	ArticleID string  `json:"articleId"`
	Title     *string `json:"title"`
}

// The most lookups a call page shows.
const maxLookupsShown = 50

// Lookups are the searches made during one of the company's calls, oldest
// first, matched by Vapi's call id within the company, each article's
// current title read within the company. moreNotShown past 50.
func Lookups(ctx context.Context, pool *database.Pool, company tenant.CompanyID, callID string) ([]Lookup, bool, error) {
	const statement = `
		SELECT lookups.id, lookups.created_at, article.id::text, articles.title
		FROM knowledge_lookups AS lookups
		JOIN calls ON calls.company_id = lookups.company_id AND calls.vapi_call_id = lookups.vapi_call_id
		LEFT JOIN LATERAL unnest(lookups.article_ids) WITH ORDINALITY AS article(id, place) ON true
		LEFT JOIN knowledge_articles AS articles ON articles.company_id = lookups.company_id AND articles.id = article.id
		WHERE lookups.company_id = $1 AND calls.id = $2
			AND lookups.id IN (SELECT first.id FROM knowledge_lookups AS first JOIN calls AS c ON c.company_id = first.company_id AND c.vapi_call_id = first.vapi_call_id
				WHERE first.company_id = $1 AND c.id = $2 ORDER BY first.created_at, first.id LIMIT $3)
		ORDER BY lookups.created_at, lookups.id, article.place`
	rows, err := pool.Query(ctx, statement, company.String(), callID, maxLookupsShown+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var list []Lookup
	for rows.Next() {
		var id string
		var at time.Time
		var articleID, title *string
		if err := rows.Scan(&id, &at, &articleID, &title); err != nil {
			return nil, false, err
		}
		if len(list) == 0 || list[len(list)-1].ID != id {
			list = append(list, Lookup{ID: id, At: at, Articles: []LookupArticle{}})
		}
		if articleID != nil {
			last := &list[len(list)-1]
			last.Articles = append(last.Articles, LookupArticle{ArticleID: *articleID, Title: title})
		}
	}
	more := len(list) > maxLookupsShown
	if more {
		list = list[:maxLookupsShown]
	}
	if list == nil {
		list = []Lookup{}
	}
	return list, more, rows.Err()
}

// StoredRecording is the stored file of a call's recording (nil: none).
func StoredRecording(ctx context.Context, pool *database.Pool, company tenant.CompanyID, callID string) (key, contentType string, found bool, err error) {
	const statement = `
		SELECT recording_key, recording_content_type FROM calls
		WHERE company_id = $1 AND id = $2 AND recording_status = 'stored' AND recording_key IS NOT NULL`
	err = pool.QueryRow(ctx, statement, company.String(), callID).Scan(&key, &contentType)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	return key, contentType, err == nil, err
}

// Category is one of the company's active categories, for the escalate form.
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Categories are the company's active categories, by name.
func Categories(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]Category, error) {
	byName, names, err := activeCategories(ctx, pool, company)
	list := make([]Category, 0, len(names))
	for _, name := range names {
		list = append(list, Category{ID: byName[name], Name: name})
	}
	return list, err
}
