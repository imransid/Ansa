package tickets

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/team"
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
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
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

func TestAReturningCustomerGoesToTheirExpertAndHiddenCallersNever(t *testing.T) {
	if CustomerPhoneDigits("+266696687") != "" || CustomerPhoneDigits("0000000") != "" || CustomerPhoneDigits("+39 051") != "" {
		t.Fatal("placeholders, repeats and short numbers are nobody")
	}
	if CustomerPhoneDigits("+39 051 123 4567") != "390511234567" {
		t.Fatal("digits")
	}
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	creator := database.TestOwner(t, pool, companyID)
	expert := database.TestOwner(t, pool, companyID)
	exec(t, pool, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel, customer_phone, assigned_to_user_id, assigned_automatically)
		VALUES ($1, 50, 'old', 'old', 'phone', '0039-051-1234567', $2, false)`, companyID, expert)
	exec(t, pool, `UPDATE companies SET last_ticket_number = 50 WHERE id = $1`, companyID)
	number, err := CreateManual(ctx, pool, company, creator, NewRequest{Subject: "Called again", Description: "Same issue.", Phone: "+39 051 123 4567"})
	if err != nil || number != 51 {
		t.Fatalf("created: %d %v", number, err)
	}
	var assignee string
	pool.QueryRow(ctx, `SELECT assigned_to_user_id FROM tickets WHERE company_id = $1 AND ticket_number = 51`, companyID).Scan(&assignee)
	if assignee == expert {
		t.Fatal("0039... and +39... are different digits: no match (a known gap)")
	}
	number, _ = CreateManual(ctx, pool, company, creator, NewRequest{Subject: "Again", Description: "x", Phone: "0039 051 1234567"})
	pool.QueryRow(ctx, `SELECT assigned_to_user_id FROM tickets WHERE company_id = $1 AND ticket_number = $2`, companyID, number).Scan(&assignee)
	if assignee != expert {
		t.Fatal("the same digits go to the expert who has their open request")
	}
}

// A request from a call carries the caller's number: it goes first to
// whoever has that caller's other open request (same-customer routing, as
// every new request), whatever its category, and they are emailed.
func TestACallersRequestGoesToTheExpertOfTheirOtherOpenRequest(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	theirs := database.TestOwner(t, pool, companyID)
	ordersExpert := database.TestOwner(t, pool, companyID)
	var categoryID string
	pool.QueryRow(ctx, `INSERT INTO categories (company_id, name) VALUES ($1, 'Orders') RETURNING id`, companyID).Scan(&categoryID)
	exec(t, pool, `INSERT INTO user_categories (company_id, user_id, category_id) VALUES ($1, $2, $3)`, companyID, ordersExpert, categoryID)
	exec(t, pool, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel, customer_phone, assigned_to_user_id, assigned_automatically)
		VALUES ($1, 70, 'typed in', 'x', 'manual', '+39 333 123 4567', $2, false)`, companyID, theirs)
	exec(t, pool, `UPDATE companies SET last_ticket_number = 70 WHERE id = $1`, companyID)
	conversationID, err := conversations.ConversationFor(ctx, pool, company, conversations.ContactKey{Channel: conversations.ChannelPhone, ExternalID: "393331234567"})
	if err != nil {
		t.Fatal(err)
	}
	var created Created
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		var err error
		created, err = CreateChatTicketWithin(ctx, tx, company, NewChatTicket{Channel: "phone", Subject: "Called again", Description: "x", CategoryID: categoryID,
			CustomerPhone: "393331234567", ConversationID: conversationID})
		return err
	})
	if err != nil || created.AssigneeID != theirs {
		t.Fatalf("their expert, whatever the category: %+v %v", created, err)
	}
	var phone, kind string
	var category *string
	pool.QueryRow(ctx, `SELECT customer_phone FROM tickets WHERE company_id = $1 AND id = $2`, companyID, created.ID).Scan(&phone)
	pool.QueryRow(ctx, `SELECT kind, category FROM ticket_activity WHERE company_id = $1 AND ticket_id = $2`, companyID, created.ID).Scan(&kind, &category)
	if phone != "393331234567" || kind != "routed" || category != nil {
		t.Fatalf("the caller's number on the request; routed as the same customer's (no category): %q %q %v", phone, kind, category)
	}
	var emails int
	pool.QueryRow(ctx, `SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'ticket.assigned' AND payload->>'ticketId' = $2`, companyID, created.ID).Scan(&emails)
	if emails != 1 {
		t.Fatalf("whoever it lands on is emailed: %d", emails)
	}
}
