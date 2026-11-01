package media

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Reading one company's library: a page of it with who added each asset,
// a generated one's prompt and the drafts using it; the totals; one asset
// to serve; the newest of a kind for a draft's picker; where assets stand
// in the list. Every join also matches company_id.

// Asset is one image or video.
type Asset struct {
	ID           string    `json:"id"`
	Kind         string    `json:"kind"`
	Source       string    `json:"source"`
	ContentType  string    `json:"contentType"`
	SizeBytes    int       `json:"sizeBytes"`
	Width        *int      `json:"width"`
	Height       *int      `json:"height"`
	OriginalName *string   `json:"originalName"`
	AltText      string    `json:"altText"`
	Provider     *string   `json:"provider"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ListItem is an asset as the library lists it.
type ListItem struct {
	Asset
	CreatedByName *string `json:"createdByName"`
	// A generated one: what it was asked for.
	Prompt *string      `json:"prompt"`
	UsedBy []DraftUsing `json:"usedBy"`
}

// DraftUsing is a draft that has an asset attached.
type DraftUsing struct {
	AssetID string `json:"assetId"`
	DraftID string `json:"draftId"`
	Topic   string `json:"topic"`
	Status  string `json:"status"`
}

const assetColumns = `a.id::text, a.kind, a.source, a.content_type, a.size_bytes, a.width, a.height, a.original_name, a.alt_text, a.provider, a.created_at`

func (a *Asset) targets() []any {
	return []any{&a.ID, &a.Kind, &a.Source, &a.ContentType, &a.SizeBytes, &a.Width, &a.Height, &a.OriginalName, &a.AltText, &a.Provider, &a.CreatedAt}
}

// List is one page (from 1) of one company's assets, newest first, each
// with the drafts using it.
func List(ctx context.Context, pool *database.Pool, company tenant.CompanyID, page int) ([]ListItem, error) {
	const statement = `
		SELECT ` + assetColumns + `, creator.name, job.prompt
		FROM media_assets AS a
		LEFT JOIN users AS creator ON creator.id = a.created_by_user_id AND creator.company_id = a.company_id
		LEFT JOIN media_generation_jobs AS job ON job.id = a.generation_job_id AND job.company_id = a.company_id
		WHERE a.company_id = $1
		ORDER BY a.created_at DESC, a.id DESC LIMIT $2 OFFSET $3`
	rows, err := pool.Query(ctx, statement, company.String(), PageSize, (max(page, 1)-1)*PageSize)
	if err != nil {
		return nil, err
	}
	items := []ListItem{}
	var ids []string
	for rows.Next() {
		item := ListItem{UsedBy: []DraftUsing{}}
		if err := rows.Scan(append(item.targets(), &item.CreatedByName, &item.Prompt)...); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, item)
		ids = append(ids, item.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	using, err := DraftsUsing(ctx, pool, company, ids)
	if err != nil {
		return nil, err
	}
	for i := range items {
		for _, draft := range using {
			if draft.AssetID == items[i].ID {
				items[i].UsedBy = append(items[i].UsedBy, draft)
			}
		}
	}
	return items, nil
}

// DraftsUsing are one company's drafts using these assets, last changed first.
func DraftsUsing(ctx context.Context, pool *database.Pool, company tenant.CompanyID, assetIDs []string) ([]DraftUsing, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `SELECT media_asset_id::text, id::text, topic, status FROM content_drafts
		WHERE company_id = $1 AND media_asset_id = ANY($2::uuid[]) ORDER BY updated_at DESC`, company.String(), assetIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var drafts []DraftUsing
	for rows.Next() {
		var draft DraftUsing
		if err := rows.Scan(&draft.AssetID, &draft.DraftID, &draft.Topic, &draft.Status); err != nil {
			return nil, err
		}
		drafts = append(drafts, draft)
	}
	return drafts, rows.Err()
}

// RowReader is a pool or a transaction.
type RowReader interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Totals is how many assets one company keeps, and their bytes together.
func Totals(ctx context.Context, q RowReader, company tenant.CompanyID) (count, totalBytes int, err error) {
	err = q.QueryRow(ctx, `SELECT count(*), COALESCE(sum(size_bytes), 0) FROM media_assets WHERE company_id = $1`, company.String()).Scan(&count, &totalBytes)
	return count, totalBytes, err
}

// Find reads one asset of one company with where it is stored (nil: unknown).
func Find(ctx context.Context, pool *database.Pool, company tenant.CompanyID, assetID string) (*Asset, string, error) {
	var asset Asset
	var key string
	err := pool.QueryRow(ctx, `SELECT `+assetColumns+`, a.storage_key FROM media_assets AS a WHERE a.company_id = $1 AND a.id = $2`,
		company.String(), assetID).Scan(append(asset.targets(), &key)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	return &asset, key, nil
}

// Choices are one company's newest assets of one kind: what a draft's page
// offers to attach.
func Choices(ctx context.Context, pool *database.Pool, company tenant.CompanyID, kind string) ([]Asset, error) {
	rows, err := pool.Query(ctx, `SELECT `+assetColumns+` FROM media_assets AS a WHERE a.company_id = $1 AND a.kind = $2
		ORDER BY a.created_at DESC, a.id DESC LIMIT $3`, company.String(), kind, ChoicesShown)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	choices := []Asset{}
	for rows.Next() {
		var asset Asset
		if err := rows.Scan(asset.targets()...); err != nil {
			return nil, err
		}
		choices = append(choices, asset)
	}
	return choices, rows.Err()
}

// LibraryPages is the page of the library (50 to a page, newest first)
// that shows each of these assets, for links to its card; unknown ids are
// left out. WHY: an older file isn't on the first page.
func LibraryPages(ctx context.Context, pool *database.Pool, company tenant.CompanyID, assetIDs []string) (map[string]int, error) {
	pages := map[string]int{}
	if len(assetIDs) == 0 {
		return pages, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, position FROM (
			SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS position FROM media_assets WHERE company_id = $1
		) AS ranked WHERE id = ANY($2::uuid[])`, company.String(), assetIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var position int
		if err := rows.Scan(&id, &position); err != nil {
			return nil, err
		}
		pages[id] = (position + PageSize - 1) / PageSize
	}
	return pages, rows.Err()
}
