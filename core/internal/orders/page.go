package orders

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// How many orders each list of the Orders page shows.
const (
	openShown     = 100
	finishedShown = 30
)

// PageOrder is one order as the Orders page shows it.
type PageOrder struct {
	ID               string     `json:"id"`
	ConversationID   string     `json:"conversationId"`
	Number           int        `json:"number"`
	Status           string     `json:"status"`
	Fulfilment       string     `json:"fulfilment"`
	WantedTime       string     `json:"wantedTime"`
	Currency         string     `json:"currency"`
	DeliveryFeeCents int64      `json:"deliveryFeeCents"`
	TotalCents       int64      `json:"totalCents"`
	PlacedAt         *time.Time `json:"placedAt"`
	ContactName      *string    `json:"contactName"`
	Channel          string     `json:"channel"`
	Address          *string    `json:"address"`
	Notes            *string    `json:"notes"`
	Lines            []PageLine `json:"lines"`
}

// PageLine is one line of an order on the page.
type PageLine struct {
	Name           string `json:"name"`
	Quantity       int    `json:"quantity"`
	LineTotalCents int64  `json:"lineTotalCents"`
}

// ListForPage is the Orders page: the orders still to do (oldest first:
// first come, first served) and the newest finished or cancelled ones, the
// address and notes decrypted.
func ListForPage(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID) (open, finished []PageOrder, err error) {
	if open, err = readPageOrders(ctx, pool, box, company, []string{"new", "accepted", "ready"}, "ASC", openShown); err != nil {
		return nil, nil, err
	}
	finished, err = readPageOrders(ctx, pool, box, company, []string{"done", "cancelled"}, "DESC", finishedShown)
	return open, finished, err
}

// CountNew is how many new orders wait to be accepted (Home's "Needs you").
func CountNew(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM orders WHERE company_id = $1 AND status = 'new'`, company.String()).Scan(&n)
	return n, err
}

func readPageOrders(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, statuses []string, direction string, limit int) ([]PageOrder, error) {
	// direction is one of two fixed words from this file, never input.
	order := "orders.placed_at ASC"
	if direction == "DESC" {
		order = "orders.created_at DESC"
	}
	statement := `
		SELECT orders.id, orders.conversation_id, orders.order_number, orders.status, orders.fulfilment, orders.wanted_time,
			orders.currency, orders.delivery_fee_cents, orders.total_cents, orders.placed_at, contacts.display_name, contacts.channel,
			orders.address_encrypted, orders.notes_encrypted
		FROM orders
		JOIN conversations ON conversations.id = orders.conversation_id AND conversations.company_id = orders.company_id
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE orders.company_id = $1 AND orders.status = ANY($2) AND orders.order_number IS NOT NULL
		ORDER BY ` + order + `, orders.id LIMIT $3`
	rows, err := pool.Query(ctx, statement, company.String(), statuses, limit)
	if err != nil {
		return nil, err
	}
	var list []PageOrder
	for rows.Next() {
		var o PageOrder
		var address, notes *string
		if err := rows.Scan(&o.ID, &o.ConversationID, &o.Number, &o.Status, &o.Fulfilment, &o.WantedTime, &o.Currency, &o.DeliveryFeeCents,
			&o.TotalCents, &o.PlacedAt, &o.ContactName, &o.Channel, &address, &notes); err != nil {
			return nil, err
		}
		o.Address = readField(box, company, o.ID, "address", address)
		o.Notes = readField(box, company, o.ID, "notes", notes)
		list = append(list, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range list {
		lines, err := linesOf(ctx, pool, company, list[i].ID)
		if err != nil {
			return nil, err
		}
		for _, l := range lines {
			list[i].Lines = append(list[i].Lines, PageLine{Name: l.Name, Quantity: l.Quantity, LineTotalCents: l.LineTotalCents})
		}
	}
	return list, nil
}

// readField decrypts an order's address or notes for the page.
func readField(box *secure.Box, company tenant.CompanyID, orderID, field string, encrypted *string) *string {
	if encrypted == nil {
		return nil
	}
	text, err := box.Decrypt(*encrypted, FieldContext(company, orderID, field))
	if err != nil {
		text = "(could not be decrypted)"
	}
	return &text
}
