package conversations

import (
	"context"
	"crypto/rand"
	"fmt"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func newID(t *testing.T) string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func TestACustomerMessageIsSavedOnceInItsConversation(t *testing.T) {
	pool := database.ForTest(t)
	company, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	name := "Lea"
	contact := ContactKey{Channel: ChannelStandIn, ExternalID: "lea", DisplayName: &name}
	ctx := context.Background()
	first, err := InsertCustomerMessage(ctx, pool, company, contact, IncomingMessage{ID: newID(t), BodyEncrypted: "v1:x:y:z", ChannelMessageID: "m-1"})
	if err != nil || first == nil {
		t.Fatalf("first save: %v %v", first, err)
	}
	again, err := InsertCustomerMessage(ctx, pool, company, contact, IncomingMessage{ID: newID(t), BodyEncrypted: "v1:x:y:z", ChannelMessageID: "m-1"})
	if err != nil || again != nil {
		t.Fatalf("the same channel message must be saved once: %v %v", again, err)
	}
	second, _ := InsertCustomerMessage(ctx, pool, company, contact, IncomingMessage{ID: newID(t), BodyEncrypted: "v1:x:y:z", ChannelMessageID: "m-2"})
	if second.ConversationID != first.ConversationID {
		t.Fatal("one conversation per contact")
	}
	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM messages WHERE company_id = $1`, company.String()).Scan(&count)
	if count != 2 {
		t.Fatalf("got %d messages", count)
	}
}

func TestTheBusinessAnsweringItselfStopsTheWait(t *testing.T) {
	pool := database.ForTest(t)
	company, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	contact := ContactKey{Channel: ChannelStandIn, ExternalID: "sam"}
	ctx := context.Background()
	turn, _ := InsertCustomerMessage(ctx, pool, company, contact, IncomingMessage{ID: newID(t), BodyEncrypted: "v1:x:y:z", ChannelMessageID: "c-1"})
	pool.Exec(ctx, `UPDATE conversations SET assistant_due_at = now() + interval '5 minutes' WHERE company_id = $1 AND id = $2`, company.String(), turn.ConversationID)
	saved, err := InsertBusinessAccountMessage(ctx, pool, company, contact, IncomingMessage{ID: newID(t), BodyEncrypted: "v1:x:y:z", ChannelMessageID: "b-1"})
	if err != nil || !saved {
		t.Fatalf("saved=%v err=%v", saved, err)
	}
	var due *string
	pool.QueryRow(ctx, `SELECT assistant_due_at::text FROM conversations WHERE company_id = $1 AND id = $2`, company.String(), turn.ConversationID).Scan(&due)
	if due != nil {
		t.Fatal("answering yourself must stop the assistant's wait")
	}
}
