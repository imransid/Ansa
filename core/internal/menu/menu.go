// Package menu is a business's menu (the old services/menu.ts, db/menu.ts):
// owners add, change, move and delete dishes (one typed in, or a whole
// menu reading after "Looks right"); anyone in the company marks a dish
// "Not available today". Prices are typed as text and stored in the
// currency's smallest units, so a menu needs a currency first.
package menu

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/money"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// Limits, as the old lib/menu.ts.
const (
	ItemsMax           = 500
	ItemsPerReadingMax = 150
)

// What a write ended in.
const (
	Saved      = "saved"
	NotAllowed = "not-allowed"
	NotFound   = "not-found"
	TooMany    = "too-many"
)

// Item is one dish as the menu page shows it.
type Item struct {
	ID          string `json:"id"`
	Category    string `json:"category"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PriceCents  int64  `json:"priceCents"`
	Available   bool   `json:"available"`
}

// Typed is one dish as typed: in the add and edit forms, and each row of a
// checked menu reading.
type Typed struct {
	Category    string `json:"category"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       string `json:"price"`
}

// Fields is a typed dish cleaned, its price in smallest units.
type Fields struct {
	Category    string `json:"category"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PriceCents  int64  `json:"priceCents"`
}

// Check cleans a typed dish and prices it in the currency; problems by
// field, in the old form's words.
func (t Typed) Check(currency string) (Fields, map[string]string) {
	f := Fields{Category: plaintext.SingleLine(t.Category), Name: plaintext.SingleLine(t.Name), Description: plaintext.SingleLine(t.Description)}
	problems := map[string]string{}
	if utf8.RuneCountInString(f.Category) > 60 {
		problems["category"] = "At most 60 characters."
	}
	switch {
	case f.Name == "":
		problems["name"] = "Give the dish a name."
	case utf8.RuneCountInString(f.Name) > 120:
		problems["name"] = "At most 120 characters."
	}
	if utf8.RuneCountInString(f.Description) > 500 {
		problems["description"] = "At most 500 characters."
	}
	price := strings.TrimSpace(t.Price)
	switch {
	case price == "":
		problems["price"] = "Give the dish a price."
	case len(price) > 20 || money.ParsePrice(price, currency) < 0:
		problems["price"] = "Write a price like 9.50."
	default:
		f.PriceCents = money.ParsePrice(price, currency)
	}
	return f, problems
}

// List is the company's dishes in menu order; "Not available today" ends by
// itself at the business's midnight (read with the database's clock).
func List(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]Item, error) {
	const statement = `
		SELECT id, category, name, description, price_cents, (unavailable_until IS NULL OR unavailable_until <= now())
		FROM catalog_items WHERE company_id = $1 ORDER BY position, created_at`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	items := []Item{}
	for rows.Next() {
		var i Item
		if err := rows.Scan(&i.ID, &i.Category, &i.Name, &i.Description, &i.PriceCents, &i.Available); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

// Currency is the menu's currency ("" until setup's orders step chose one).
func Currency(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (string, error) {
	var currency *string
	err := pool.QueryRow(ctx, `SELECT currency FROM assistant_settings WHERE company_id = $1`, company.String()).Scan(&currency)
	if errors.Is(err, pgx.ErrNoRows) || currency == nil {
		return "", nil
	}
	return *currency, err
}

// EndOfLocalDay is the next midnight in the zone (Go's own rules handle a
// clock change that night).
func EndOfLocalDay(zone *time.Location, now time.Time) time.Time {
	local := now.In(zone)
	return time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, zone)
}

// ownerWithin reads the person again: owners edit the menu.
func ownerWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID string) (bool, error) {
	role, err := team.RoleWithin(ctx, tx, company, actorUserID)
	return role == "owner", err
}

func ignoreNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}
