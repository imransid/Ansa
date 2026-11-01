package drafts

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Reading one company's drafts for the content studio's list (the old
// db/content-drafts.ts): one page, last changed first, and the counts on
// the status links.

// PageSize is how many drafts one page lists.
const PageSize = 50

// ListItem is one draft as the list shows it.
type ListItem struct {
	ID            string    `json:"id"`
	Topic         string    `json:"topic"`
	Platform      string    `json:"platform"`
	Format        string    `json:"format"`
	Status        string    `json:"status"`
	Version       int       `json:"version"`
	UpdatedAt     time.Time `json:"updatedAt"`
	UpdatedByName *string   `json:"updatedByName"`
}

// ListFilters are the list's ?status= ("current": all but archived, or one
// status) and ?platform= ("all" or one).
var ListFilters = append([]string{"current"}, Statuses...)

// List is one page (from 1) of one company's drafts with this status
// filter on this platform ("all": every one), last changed first. The
// company first; the person's name is read within it.
func List(ctx context.Context, pool *database.Pool, company tenant.CompanyID, status, platform string, page int) ([]ListItem, error) {
	const statement = `
		SELECT d.id, d.topic, d.platform, d.format, d.status, d.version, d.updated_at, updater.name
		FROM content_drafts AS d
		LEFT JOIN users AS updater ON updater.id = d.updated_by_user_id AND updater.company_id = d.company_id
		WHERE d.company_id = $1
			AND (($2 = 'current' AND d.status <> 'archived') OR d.status = $2)
			AND ($3 = 'all' OR d.platform = $3)
		ORDER BY d.updated_at DESC, d.id DESC
		LIMIT $4 OFFSET $5`
	rows, err := pool.Query(ctx, statement, company.String(), status, platform, PageSize, (max(page, 1)-1)*PageSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ListItem{}
	for rows.Next() {
		var item ListItem
		if err := rows.Scan(&item.ID, &item.Topic, &item.Platform, &item.Format, &item.Status, &item.Version, &item.UpdatedAt, &item.UpdatedByName); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// CountPerStatus counts one company's drafts on one platform ("all": every
// one) per list filter: "current" and each status.
func CountPerStatus(ctx context.Context, pool *database.Pool, company tenant.CompanyID, platform string) (map[string]int, error) {
	const statement = `
		SELECT count(*) FILTER (WHERE status <> 'archived'),
			count(*) FILTER (WHERE status = 'idea'), count(*) FILTER (WHERE status = 'draft'),
			count(*) FILTER (WHERE status = 'approved'), count(*) FILTER (WHERE status = 'rejected'),
			count(*) FILTER (WHERE status = 'scheduled'), count(*) FILTER (WHERE status = 'published'),
			count(*) FILTER (WHERE status = 'failed'), count(*) FILTER (WHERE status = 'archived')
		FROM content_drafts
		WHERE company_id = $1 AND ($2 = 'all' OR platform = $2)`
	counts := make([]int, len(ListFilters))
	targets := make([]any, len(counts))
	for i := range counts {
		targets[i] = &counts[i]
	}
	if err := pool.QueryRow(ctx, statement, company.String(), platform).Scan(targets...); err != nil {
		return nil, err
	}
	byFilter := map[string]int{}
	for i, filter := range ListFilters {
		byFilter[filter] = counts[i]
	}
	return byFilter, nil
}
