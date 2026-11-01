package knowledge

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// One page of the list holds 50 articles.
const pageSize = 50

// Line is one article in the list.
type Line struct {
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	Kind            string    `json:"kind"`
	Status          string    `json:"status"`
	UseForSupport   bool      `json:"useForSupport"`
	UseForMarketing bool      `json:"useForMarketing"`
	UpdatedAt       time.Time `json:"updatedAt"`
	UpdatedByName   *string   `json:"updatedByName"`
}

// IsStatusFilter: "all", or one of the statuses (odd values fall back to "all").
func IsStatusFilter(status string) bool {
	return status == "all" || statuses[status]
}

// likePattern is a title search with %, _ and \ escaped.
func likePattern(q string) string {
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	return "%" + escaped + "%"
}

// List is one page of the company's articles, last changed first, with a
// status filter and a title search.
func List(ctx context.Context, pool *database.Pool, company tenant.CompanyID, status, q string, page int) ([]Line, error) {
	const statement = `
		SELECT articles.id, articles.title, articles.kind, articles.status, articles.use_for_support, articles.use_for_marketing,
			articles.updated_at, updater.name
		FROM knowledge_articles AS articles
		LEFT JOIN users AS updater ON updater.company_id = articles.company_id AND updater.id = articles.updated_by_user_id
		WHERE articles.company_id = $1 AND ($2 = 'all' OR articles.status = $2) AND ($3 = '' OR articles.title ILIKE $4)
		ORDER BY articles.updated_at DESC, articles.id DESC
		LIMIT $5 OFFSET $6`
	rows, err := pool.Query(ctx, statement, company.String(), status, q, likePattern(q), pageSize, (max(page, 1)-1)*pageSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lines := []Line{}
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.ID, &l.Title, &l.Kind, &l.Status, &l.UseForSupport, &l.UseForMarketing, &l.UpdatedAt, &l.UpdatedByName); err != nil {
			return nil, err
		}
		lines = append(lines, l)
	}
	return lines, rows.Err()
}

// Counts are the company's articles per status, with the title search.
func Counts(ctx context.Context, pool *database.Pool, company tenant.CompanyID, q string) (map[string]int, error) {
	const statement = `
		SELECT count(*), count(*) FILTER (WHERE status = 'draft'), count(*) FILTER (WHERE status = 'approved'), count(*) FILTER (WHERE status = 'archived')
		FROM knowledge_articles WHERE company_id = $1 AND ($2 = '' OR title ILIKE $3)`
	var all, draft, approved, archived int
	err := pool.QueryRow(ctx, statement, company.String(), q, likePattern(q)).Scan(&all, &draft, &approved, &archived)
	return map[string]int{"all": all, "draft": draft, "approved": approved, "archived": archived}, err
}

// Detail is one article with where it came from and who wrote, changed and approved it.
type Detail struct {
	Line
	Body               string     `json:"body"`
	Revision           int        `json:"revision"`
	SourceURL          *string    `json:"sourceUrl"`
	SourceDocumentName *string    `json:"sourceDocumentName"`
	SourceTicketNumber *int       `json:"sourceTicketNumber"`
	CreatedAt          time.Time  `json:"createdAt"`
	CreatedByName      *string    `json:"createdByName"`
	ApprovedAt         *time.Time `json:"approvedAt"`
	ApprovedByName     *string    `json:"approvedByName"`
	Pieces             int        `json:"pieces"`
}

// Read is one article of the company (nil: unknown, or another company's).
// Every join matches the company too: a name from another company never shows.
func Read(ctx context.Context, pool *database.Pool, company tenant.CompanyID, articleID string) (*Detail, error) {
	const statement = `
		SELECT articles.id, articles.title, articles.kind, articles.status, articles.use_for_support, articles.use_for_marketing,
			articles.updated_at, updater.name, articles.body, articles.revision, articles.source_url, documents.file_name, tickets.ticket_number,
			articles.created_at, creator.name, articles.approved_at, approver.name,
			(SELECT count(*) FROM knowledge_chunks WHERE company_id = $1 AND article_id = articles.id)
		FROM knowledge_articles AS articles
		LEFT JOIN company_documents AS documents ON documents.company_id = articles.company_id AND documents.id = articles.source_document_id
		LEFT JOIN tickets ON tickets.company_id = articles.company_id AND tickets.id = articles.source_ticket_id
		LEFT JOIN users AS creator ON creator.company_id = articles.company_id AND creator.id = articles.created_by_user_id
		LEFT JOIN users AS updater ON updater.company_id = articles.company_id AND updater.id = articles.updated_by_user_id
		LEFT JOIN users AS approver ON approver.company_id = articles.company_id AND approver.id = articles.approved_by_user_id
		WHERE articles.company_id = $1 AND articles.id::text = $2`
	var d Detail
	err := pool.QueryRow(ctx, statement, company.String(), articleID).Scan(&d.ID, &d.Title, &d.Kind, &d.Status, &d.UseForSupport, &d.UseForMarketing,
		&d.UpdatedAt, &d.UpdatedByName, &d.Body, &d.Revision, &d.SourceURL, &d.SourceDocumentName, &d.SourceTicketNumber,
		&d.CreatedAt, &d.CreatedByName, &d.ApprovedAt, &d.ApprovedByName, &d.Pieces)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &d, err
}
