package tickets

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func exec(t *testing.T, pool *database.Pool, statement string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), statement, args...); err != nil {
		t.Fatalf("setup: %v", err)
	}
}

func TestAChatRequestIsNumberedAndGoesToTheLeastBusyExpertOfItsCategory(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	busy := database.TestOwner(t, pool, companyID)
	free := database.TestOwner(t, pool, companyID)
	unconfirmed := database.TestOwner(t, pool, companyID)
	exec(t, pool, `UPDATE users SET email_verified = false WHERE company_id = $1 AND id = $2`, companyID, unconfirmed)
	var categoryID string
	pool.QueryRow(ctx, `INSERT INTO categories (company_id, name) VALUES ($1, 'Orders') RETURNING id`, companyID).Scan(&categoryID)
	for _, user := range []string{busy, free, unconfirmed} {
		exec(t, pool, `INSERT INTO user_categories (company_id, user_id, category_id) VALUES ($1, $2, $3)`, companyID, user, categoryID)
	}
	turn, _ := conversations.InsertCustomerMessage(ctx, pool, company, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "t"}, conversations.IncomingMessage{ID: "77777777-7777-4777-8777-777777777777", BodyEncrypted: "v1:x:y:z", ChannelMessageID: "t1"})
	exec(t, pool, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel, assigned_to_user_id, assigned_automatically) VALUES ($1, 900, 'old', 'old', 'chat', $2, false)`, companyID, busy)

	var first, second Created
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		var err error
		if first, err = CreateChatTicketWithin(ctx, tx, company, NewChatTicket{Subject: "Wants to order", Description: "Two pizzas.", CategoryID: categoryID, ConversationID: turn.ConversationID}); err != nil {
			return err
		}
		second, err = CreateChatTicketWithin(ctx, tx, company, NewChatTicket{Subject: "Question", Description: "?", ConversationID: turn.ConversationID})
		return err
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if first.AssigneeID != free || second.AssigneeID != "" || second.Number != first.Number+1 {
		t.Fatalf("first %+v, second %+v (free %s)", first, second, free)
	}
	var kind, category string
	pool.QueryRow(ctx, `SELECT kind, category FROM ticket_activity WHERE company_id = $1 AND ticket_id = $2`, companyID, first.ID).Scan(&kind, &category)
	if kind != "routed" || category != "Orders" {
		t.Fatalf("history: %s %s", kind, category)
	}
}
