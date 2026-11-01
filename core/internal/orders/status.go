package orders

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// The buttons of the Orders page: which statuses each moves from, and to.
var nextStatus = map[string]struct {
	from []string
	to   string
}{
	"accept": {from: []string{"new"}, to: "accepted"},
	"ready":  {from: []string{"accepted"}, to: "ready"},
	"done":   {from: []string{"accepted", "ready"}, to: "done"},
	"cancel": {from: []string{"new", "accepted", "ready"}, to: "cancelled"},
}

// IsChange reports whether change is one of the page's buttons.
func IsChange(change string) bool {
	_, known := nextStatus[change]
	return known
}

// What a change ended in.
const (
	ChangeDone       = "changed"
	ChangeNotFound   = "not-found"
	ChangeNotAllowed = "not-allowed"
	ChangeMeanwhile  = "changed-meanwhile"
)

// ChangeResult is the outcome and, when the status changed, why the
// customer wasn't told: "" (told), a chat refusal ("window-closed",
// "not-connected", ...) or "send-failed".
type ChangeResult struct {
	Outcome    string
	NotToldWhy string
}

// StatusChange is one person moving one order on.
type StatusChange struct {
	Pool   *database.Pool
	Box    *secure.Box
	Sender *chat.Sender
}

// Change moves the order on and tells the customer (the old
// services/orders.ts): anyone in the company, read again FOR SHARE; the
// status checked in the UPDATE itself (a second press finds it changed);
// the customer's short fixed message saved in the same transaction, as a
// person's message that doesn't take the conversation over, only when
// their chat may take one now.
func (c *StatusChange) Change(ctx context.Context, company tenant.CompanyID, actorUserID, orderID, change string) (ChangeResult, error) {
	step := nextStatus[change]
	number, fulfilment, status, found, err := readPlaced(ctx, c.Pool, company, orderID)
	if err != nil || !found {
		return ChangeResult{Outcome: ChangeNotFound}, err
	}
	text := StatusText(change, number, fulfilment, status == "new")
	messageID, err := conversations.NewID()
	if err != nil {
		return ChangeResult{}, err
	}
	body, err := c.Box.Encrypt(text, conversations.MessageContext(company, messageID))
	if err != nil {
		return ChangeResult{}, err
	}
	outcome, refusal := ChangeDone, ""
	var target chat.Target
	err = database.InTx(ctx, c.Pool, func(tx database.Tx) error {
		var role string
		err := tx.QueryRow(ctx, `SELECT role FROM users WHERE company_id = $1 AND id = $2 AND email_verified = true AND deactivated_at IS NULL FOR SHARE`, company.String(), actorUserID).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) {
			outcome = ChangeNotAllowed
			return nil
		}
		if err != nil {
			return err
		}
		const update = `
			UPDATE orders SET status = $3, updated_by_user_id = $4, updated_at = now()
			WHERE company_id = $1 AND id = $2 AND status = ANY($5)
			RETURNING conversation_id`
		var conversationID string
		err = tx.QueryRow(ctx, update, company.String(), orderID, step.to, actorUserID, step.from).Scan(&conversationID)
		if errors.Is(err, pgx.ErrNoRows) {
			outcome = ChangeMeanwhile
			return nil
		}
		if err != nil {
			return err
		}
		if target, refusal, err = chat.RouteWithin(ctx, tx, company, conversationID); err != nil || refusal != "" {
			return err
		}
		const message = `
			INSERT INTO messages (id, company_id, conversation_id, direction, author, author_user_id, body_encrypted, send_status)
			VALUES ($1, $2, $3, 'out', 'person', $4, $5, 'sending')`
		if _, err := tx.Exec(ctx, message, messageID, company.String(), conversationID, actorUserID, body); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE conversations SET last_activity_at = now() WHERE company_id = $1 AND id = $2`, company.String(), conversationID)
		return err
	})
	if err != nil || outcome != ChangeDone {
		return ChangeResult{Outcome: outcome}, err
	}
	if refusal != "" {
		return ChangeResult{Outcome: ChangeDone, NotToldWhy: refusal}, nil
	}
	result := c.Sender.Send(ctx, target, messageID, text)
	if err := chat.RecordDelivery(ctx, c.Pool, company, messageID, result); err != nil {
		return ChangeResult{}, err
	}
	if result.Status == "failed" {
		return ChangeResult{Outcome: ChangeDone, NotToldWhy: "send-failed"}, nil
	}
	return ChangeResult{Outcome: ChangeDone}, nil
}

// readPlaced reads what the message needs (a number and a way of delivery
// never change once an order is placed).
func readPlaced(ctx context.Context, pool *database.Pool, company tenant.CompanyID, orderID string) (int, string, string, bool, error) {
	var number *int
	var fulfilment, status string
	err := pool.QueryRow(ctx, `SELECT order_number, fulfilment, status FROM orders WHERE company_id = $1 AND id = $2`, company.String(), orderID).Scan(&number, &fulfilment, &status)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && number == nil) {
		return 0, "", "", false, nil
	}
	if err != nil {
		return 0, "", "", false, err
	}
	return *number, fulfilment, status, true, nil
}
