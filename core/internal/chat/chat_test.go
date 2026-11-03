package chat

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func customerTurn(t *testing.T, pool *database.Pool, company tenant.CompanyID, contact conversations.ContactKey, id string) *conversations.Turn {
	turn, err := conversations.InsertCustomerMessage(context.Background(), pool, company, contact, conversations.IncomingMessage{ID: id, BodyEncrypted: "v1:x:y:z", ChannelMessageID: "c-" + id})
	if err != nil || turn == nil {
		t.Fatalf("customer message: %v", err)
	}
	return turn
}

func routeOf(t *testing.T, pool *database.Pool, company tenant.CompanyID, conversationID string) (Target, string) {
	var target Target
	var refusal string
	err := database.InTx(context.Background(), pool, func(tx database.Tx) error {
		var err error
		target, refusal, err = RouteWithin(context.Background(), tx, company, conversationID)
		return err
	})
	if err != nil {
		t.Fatalf("route: %v", err)
	}
	return target, refusal
}

func TestTelegramNeedsAConnectedAccountThatMayReplyWithin24Hours(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	company, _ := tenant.FromTrustedSource(companyID)
	turn := customerTurn(t, pool, company, conversations.ContactKey{Channel: conversations.ChannelTelegram, ExternalID: "555"}, "11111111-1111-4111-8111-111111111111")
	if _, refusal := routeOf(t, pool, company, turn.ConversationID); refusal != RefusedNotConnected {
		t.Fatalf("no account: %q", refusal)
	}
	ctx := context.Background()
	pool.Exec(ctx, `INSERT INTO channel_connections (company_id, channel, external_id, account_telegram_id, account_chat_id, display_name, connected_by_user_id, status)
		VALUES ($1, 'telegram', 'bc-route', '1', '1', 'x', $2, 'cannot_reply')`, companyID, owner)
	if _, refusal := routeOf(t, pool, company, turn.ConversationID); refusal != RefusedCannotReply {
		t.Fatalf("may not reply: %q", refusal)
	}
	pool.Exec(ctx, `UPDATE channel_connections SET status = 'connected' WHERE company_id = $1`, companyID)
	target, refusal := routeOf(t, pool, company, turn.ConversationID)
	if refusal != "" || target.TelegramConnectionID != "bc-route" || target.ExternalID != "555" {
		t.Fatalf("connected: %+v %q", target, refusal)
	}
	pool.Exec(ctx, `UPDATE conversations SET last_customer_message_at = now() - interval '25 hours' WHERE company_id = $1`, companyID)
	if _, refusal := routeOf(t, pool, company, turn.ConversationID); refusal != RefusedWindowClosed {
		t.Fatalf("past 24 hours: %q", refusal)
	}
}

func TestTheStandInWritesAFileOnlyWhereAllowedAndDeliveryIsRecordedOnce(t *testing.T) {
	pool := database.ForTest(t)
	company, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	turn := customerTurn(t, pool, company, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "lea"}, "22222222-2222-4222-8222-222222222222")
	target, refusal := routeOf(t, pool, company, turn.ConversationID)
	if refusal != "" {
		t.Fatalf("stand-in route: %q", refusal)
	}
	dir := t.TempDir()
	if r := (&Sender{StandInsAllowed: false, StandInDir: dir}).Send(context.Background(), target, "m1", "hi"); r.Error != "not_connected" {
		t.Fatalf("production refuses the stand-in: %+v", r)
	}
	if r := (&Sender{StandInsAllowed: true, StandInDir: dir}).Send(context.Background(), target, "m1", "hi"); r.Status != "sent" {
		t.Fatalf("stand-in: %+v", r)
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	if len(files) != 1 {
		t.Fatalf("expected one file, got %d", len(files))
	}
	info, _ := os.Stat(files[0])
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("the file must be private: %v", info.Mode())
	}

	ctx := context.Background()
	messageID := "33333333-3333-4333-8333-333333333333"
	pool.Exec(ctx, `INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status) VALUES ($1, $2, $3, 'out', 'assistant', 'v1:x:y:z', 'sending')`, messageID, company.String(), turn.ConversationID)
	RecordDelivery(ctx, pool, company, messageID, Result{Status: "sent", ChannelMessageID: "99"})
	RecordDelivery(ctx, pool, company, messageID, Result{Status: "failed", Error: "refused"})
	var status string
	pool.QueryRow(ctx, `SELECT send_status FROM messages WHERE company_id = $1 AND id = $2`, company.String(), messageID).Scan(&status)
	if status != "sent" {
		t.Fatalf("a late failure must not undo sent: %s", status)
	}
}

func TestMessengerNeedsItsPageConnectedHereAndAllowedToMessage(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	id, _ := conversations.NewID()
	turn := customerTurn(t, pool, company, conversations.ContactKey{Channel: conversations.ChannelMessenger, ExternalID: "90901:4242"}, id)
	if _, refusal := routeOf(t, pool, company, turn.ConversationID); refusal != RefusedNotConnected {
		t.Fatalf("no Page: %q", refusal)
	}
	pool.Exec(ctx, `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id)
		VALUES ($1, 'facebook', '90901', 'Page', 'page', 'v1:x:y:z', $2)`, companyID, owner)
	if _, refusal := routeOf(t, pool, company, turn.ConversationID); refusal != RefusedCannotReply {
		t.Fatalf("connected for posts only: %q", refusal)
	}
	pool.Exec(ctx, `UPDATE social_connections SET scopes = ARRAY['pages_messaging'] WHERE company_id = $1`, companyID)
	target, refusal := routeOf(t, pool, company, turn.ConversationID)
	if refusal != "" || target.MessengerPageID != "90901" || target.MessengerPSID != "4242" || target.MessengerConnectionID == "" || target.CompanyID != company {
		t.Fatalf("allowed: %+v %q", target, refusal)
	}
	sender := &Sender{}
	if result := sender.Send(ctx, target, id, "Hi"); result.Status != "failed" || result.Error != "not_connected" {
		t.Fatalf("without ansa's Meta app nothing is sent: %+v", result)
	}
}

// WhatsApp (step 56): the number the customer wrote to, connected in this
// company (not removed on Meta's side), within 24 hours of their message;
// a stand-in number's replies are files (development only).
func TestWhatsAppNeedsItsNumberConnectedHereWithin24Hours(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	id, _ := conversations.NewID()
	phone := "stand-in:" + id
	turn := customerTurn(t, pool, company, conversations.ContactKey{Channel: conversations.ChannelWhatsApp, ExternalID: phone + ":XX.lena"}, id)
	if _, refusal := routeOf(t, pool, company, turn.ConversationID); refusal != RefusedNotConnected {
		t.Fatalf("no number: %q", refusal)
	}
	pool.Exec(ctx, `INSERT INTO whatsapp_numbers (company_id, waba_id, phone_number_id, display_phone_number, is_stand_in, connected_by_user_id, status)
		VALUES ($1, $2, $2, '+00 000 000 000', true, $3, 'removed_in_whatsapp')`, companyID, phone, owner)
	if _, refusal := routeOf(t, pool, company, turn.ConversationID); refusal != RefusedNotConnected {
		t.Fatalf("removed on Meta's side: %q", refusal)
	}
	pool.Exec(ctx, `UPDATE whatsapp_numbers SET status = 'connected' WHERE company_id = $1`, companyID)
	target, refusal := routeOf(t, pool, company, turn.ConversationID)
	if refusal != "" || target.WhatsAppPhoneNumberID != phone || target.WhatsAppCustomerID != "XX.lena" || target.WhatsAppNumberID == "" || !target.WhatsAppIsStandIn {
		t.Fatalf("connected: %+v %q", target, refusal)
	}
	dir := t.TempDir()
	if result := (&Sender{StandInsAllowed: true, StandInDir: dir}).Send(ctx, target, id, "Hi"); result.Status != "sent" {
		t.Fatalf("a stand-in's reply is a file: %+v", result)
	}
	if result := (&Sender{}).Send(ctx, target, id, "Hi"); result.Error != "not_connected" {
		t.Fatalf("never a file in production: %+v", result)
	}
	target.WhatsAppIsStandIn = false
	if result := (&Sender{}).Send(ctx, target, id, "Hi"); result.Error != "not_connected" {
		t.Fatalf("without ansa's Meta app nothing is sent: %+v", result)
	}
	pool.Exec(ctx, `UPDATE conversations SET last_customer_message_at = now() - interval '25 hours' WHERE company_id = $1`, companyID)
	if _, refusal := routeOf(t, pool, company, turn.ConversationID); refusal != RefusedWindowClosed {
		t.Fatalf("past 24 hours: %q", refusal)
	}
}
