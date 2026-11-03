package orders

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/team"
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
// "not-connected", ...) or "send-failed"; with the order's number and the
// customer's channel, which the Orders page words the reason by.
type ChangeResult struct {
	Outcome    string
	NotToldWhy string
	Number     int
	Channel    string
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
	order, found, err := readPlaced(ctx, c.Pool, company, orderID)
	if err != nil || !found {
		return ChangeResult{Outcome: ChangeNotFound}, err
	}
	language, err := customerLanguage(ctx, c.Pool, c.Box, company, order.conversationID)
	if err != nil {
		return ChangeResult{}, err
	}
	text := StatusText(change, order.number, order.fulfilment, order.status == "new", language)
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
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			if role == "" {
				outcome = ChangeNotAllowed
			}
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
	changed := ChangeResult{Outcome: ChangeDone, Number: order.number, Channel: order.channel}
	if refusal != "" {
		changed.NotToldWhy = refusal
		return changed, nil
	}
	result := c.Sender.Send(ctx, target, messageID, text)
	if err := chat.RecordDelivery(ctx, c.Pool, company, messageID, result); err != nil {
		return ChangeResult{}, err
	}
	if result.Status == "failed" {
		changed.NotToldWhy = "send-failed"
	}
	return changed, nil
}

// placedOrder is what the message and the page need of an order (its
// number, way and customer never change once it is placed).
type placedOrder struct {
	number                                      int
	fulfilment, status, channel, conversationID string
}

// readPlaced reads a placed order of the company; false when there is none.
func readPlaced(ctx context.Context, pool *database.Pool, company tenant.CompanyID, orderID string) (placedOrder, bool, error) {
	const statement = `
		SELECT orders.order_number, orders.fulfilment, orders.status, contacts.channel, orders.conversation_id FROM orders
		JOIN conversations ON conversations.id = orders.conversation_id AND conversations.company_id = orders.company_id
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE orders.company_id = $1 AND orders.id = $2`
	var number *int
	var order placedOrder
	err := pool.QueryRow(ctx, statement, company.String(), orderID).Scan(&number, &order.fulfilment, &order.status, &order.channel, &order.conversationID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && number == nil) {
		return placedOrder{}, false, nil
	}
	if err != nil {
		return placedOrder{}, false, err
	}
	order.number = *number
	return order, true, nil
}

// customerLanguage is the language of ansa's texts for the order's
// customer: their newest message's (LanguageOf). None, or one that can't
// be read, is English.
func customerLanguage(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID string) (string, error) {
	const statement = `
		SELECT id, body_encrypted FROM messages
		WHERE company_id = $1 AND conversation_id = $2 AND author = 'customer' AND body_encrypted IS NOT NULL
		ORDER BY created_at DESC LIMIT 1`
	var id, body string
	err := pool.QueryRow(ctx, statement, company.String(), conversationID).Scan(&id, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		return English, nil
	}
	if err != nil {
		return "", err
	}
	text, err := box.Decrypt(body, conversations.MessageContext(company, id))
	if err != nil {
		return English, nil
	}
	return LanguageOf(text), nil
}
