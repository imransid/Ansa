package orders

import (
	"context"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// FieldContext ties an order's encrypted address or notes to its company
// and order (the old orderFieldContext): "order-<field>:<company>:<order>".
func FieldContext(company tenant.CompanyID, orderID, field string) string {
	return "order-" + field + ":" + company.String() + ":" + orderID
}

// Proposal is an order being written up, saved with ansa's summary.
type Proposal struct {
	// A new id: the address and notes are encrypted for it.
	OrderID                          string
	Order                            Priced
	AddressEncrypted, NotesEncrypted *string
}

// SaveProposalWithin saves the order the summary describes ("proposed",
// unnumbered), replacing the one this conversation was writing up.
func SaveProposalWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, summaryMessageID string, proposal Proposal) error {
	if err := DeleteProposalWithin(ctx, tx, company, conversationID); err != nil {
		return err
	}
	o := proposal.Order
	const insert = `
		INSERT INTO orders (id, company_id, conversation_id, status, fulfilment, wanted_time, currency,
			subtotal_cents, delivery_fee_cents, total_cents, address_encrypted, notes_encrypted, summary_message_id)
		VALUES ($1, $2, $3, 'proposed', $4, $5, $6, $7, $8, $9, $10, $11, $12)`
	if _, err := tx.Exec(ctx, insert, proposal.OrderID, company.String(), conversationID, o.Fulfilment, o.Time, o.Currency,
		o.SubtotalCents, o.DeliveryFeeCents, o.TotalCents, proposal.AddressEncrypted, proposal.NotesEncrypted, summaryMessageID); err != nil {
		return err
	}
	const line = `
		INSERT INTO order_items (company_id, order_id, position, name, quantity, unit_price_cents, line_total_cents)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`
	for index, l := range o.Lines {
		if _, err := tx.Exec(ctx, line, company.String(), proposal.OrderID, index+1, l.Name, l.Quantity, l.UnitPriceCents, l.LineTotalCents); err != nil {
			return err
		}
	}
	return nil
}

// DeleteProposalWithin takes back the order being written up (its lines go with it).
func DeleteProposalWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) error {
	_, err := tx.Exec(ctx, `DELETE FROM orders WHERE company_id = $1 AND conversation_id = $2 AND status = 'proposed'`, company.String(), conversationID)
	return err
}

// Placed is an order the customer said yes to.
type Placed struct {
	OrderID    string
	Number     int
	TotalCents int64
	Currency   string
}

// PlaceWithin gives the proposal the company's next number and makes it
// "new", only once its summary reached the customer (sending, sent or
// unclear: not a draft waiting for a person, nor discarded). nil: nothing
// to say yes to. The caller took the company row lock FIRST (numbers).
func PlaceWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) (*Placed, error) {
	const shown = `
		SELECT orders.id, orders.total_cents, orders.currency FROM orders
		JOIN messages ON messages.id = orders.summary_message_id AND messages.company_id = orders.company_id
		WHERE orders.company_id = $1 AND orders.conversation_id = $2 AND orders.status = 'proposed'
			AND messages.send_status IN ('sending', 'sent', 'unclear')
		FOR UPDATE OF orders`
	var placed Placed
	err := tx.QueryRow(ctx, shown, company.String(), conversationID).Scan(&placed.OrderID, &placed.TotalCents, &placed.Currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(order_number), 0) + 1 FROM orders WHERE company_id = $1`, company.String()).Scan(&placed.Number); err != nil {
		return nil, err
	}
	const place = `
		UPDATE orders SET status = 'new', order_number = $3, placed_at = now(), updated_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'proposed'`
	_, err = tx.Exec(ctx, place, company.String(), placed.OrderID, placed.Number)
	return &placed, err
}

// ConversationOrder is an order as the assistant reads it (never an id).
type ConversationOrder struct {
	Number                         int
	Status, Fulfilment, WantedTime string
	Lines                          []Line
}

// OfConversation is the order being written up (or nil) and the newest
// placed ones (at most `placedShown`) of one conversation.
func OfConversation(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string, placedShown int) (*ConversationOrder, []ConversationOrder, error) {
	const statement = `
		SELECT id, COALESCE(order_number, 0), status, fulfilment, wanted_time FROM orders
		WHERE company_id = $1 AND conversation_id = $2
		ORDER BY created_at DESC, id LIMIT $3`
	rows, err := pool.Query(ctx, statement, company.String(), conversationID, placedShown+1)
	if err != nil {
		return nil, nil, err
	}
	var ids []string
	var found []ConversationOrder
	for rows.Next() {
		var id string
		var o ConversationOrder
		if err := rows.Scan(&id, &o.Number, &o.Status, &o.Fulfilment, &o.WantedTime); err != nil {
			return nil, nil, err
		}
		ids = append(ids, id)
		found = append(found, o)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	for i, id := range ids {
		if found[i].Lines, err = linesOf(ctx, pool, company, id); err != nil {
			return nil, nil, err
		}
	}
	var proposal *ConversationOrder
	var placed []ConversationOrder
	for i := range found {
		if found[i].Status == "proposed" {
			proposal = &found[i]
		} else if len(placed) < placedShown {
			placed = append(placed, found[i])
		}
	}
	return proposal, placed, nil
}

func linesOf(ctx context.Context, pool *database.Pool, company tenant.CompanyID, orderID string) ([]Line, error) {
	rows, err := pool.Query(ctx, `SELECT name, quantity, unit_price_cents, line_total_cents FROM order_items WHERE company_id = $1 AND order_id = $2 ORDER BY position`, company.String(), orderID)
	if err != nil {
		return nil, err
	}
	var lines []Line
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.Name, &l.Quantity, &l.UnitPriceCents, &l.LineTotalCents); err != nil {
			return nil, err
		}
		lines = append(lines, l)
	}
	return lines, rows.Err()
}

// DescribeForAssistant is each line with its menu label when the dish is
// still on today's menu, how and when (the old describeOrderForAssistant).
func DescribeForAssistant(order ConversationOrder, menu []MenuChoice) []string {
	var described []string
	for _, line := range order.Lines {
		text := strconv.Itoa(line.Quantity) + " × " + line.Name
		for _, dish := range menu {
			if dish.Name == line.Name {
				text += " (" + dish.Label + ")"
				break
			}
		}
		described = append(described, text)
	}
	how := "pickup"
	if order.Fulfilment == "delivery" {
		how = "delivery"
	}
	return append(described, how, "when: "+order.WantedTime)
}
