package comments

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// SettingsView is the comments switch as the screens show it, and the
// company's Facebook Pages with whether each may answer comments.
type SettingsView struct {
	On bool `json:"on"`
	// Owners of a business change it.
	CanChange bool       `json:"canChange"`
	Pages     []PageView `json:"pages"`
}

// PageView is one connected Facebook Page.
type PageView struct {
	Name string `json:"name"`
	// Both comment permissions granted (pages_read_user_content and
	// pages_manage_engagement), or a development stand-in.
	Allowed bool `json:"allowed"`
}

// ReadSettings reads the switch and the connected Pages.
func ReadSettings(ctx context.Context, pool *database.Pool, company tenant.CompanyID, isOwner bool) (SettingsView, error) {
	view := SettingsView{Pages: []PageView{}}
	const switchStatement = `
		SELECT companies.kind = 'business', COALESCE((SELECT comments_on FROM assistant_settings WHERE assistant_settings.company_id = companies.id), false)
		FROM companies WHERE companies.id = $1`
	var business bool
	if err := pool.QueryRow(ctx, switchStatement, company.String()).Scan(&business, &view.On); err != nil {
		return view, err
	}
	view.CanChange = isOwner && business
	const pages = `
		SELECT display_name, is_stand_in OR ('pages_read_user_content' = ANY(scopes) AND 'pages_manage_engagement' = ANY(scopes))
		FROM social_connections
		WHERE company_id = $1 AND platform = 'facebook' AND status = 'connected'
		ORDER BY connected_at, id`
	rows, err := pool.Query(ctx, pages, company.String())
	if err != nil {
		return view, err
	}
	for rows.Next() {
		var page PageView
		if err := rows.Scan(&page.Name, &page.Allowed); err != nil {
			rows.Close()
			return view, err
		}
		view.Pages = append(view.Pages, page)
	}
	return view, rows.Err()
}

// NotABusiness: one person's account has no comments to answer.
const NotABusiness = "not-business"

// SaveOn switches answering comments on or off: owners of a business only,
// the company row locked and the person read again (settings.AsOwner).
func SaveOn(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, on bool) (string, error) {
	business := true
	outcome, err := settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT kind = 'business' FROM companies WHERE id = $1`, company.String()).Scan(&business); err != nil || !business {
			return err
		}
		const upsert = `
			INSERT INTO assistant_settings (company_id, comments_on, updated_by_user_id) VALUES ($1, $2, $3)
			ON CONFLICT (company_id) DO UPDATE SET comments_on = $2, updated_by_user_id = $3, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), on, actorUserID)
		return err
	})
	if err == nil && outcome == settings.Saved && !business {
		return NotABusiness, nil
	}
	return outcome, err
}
