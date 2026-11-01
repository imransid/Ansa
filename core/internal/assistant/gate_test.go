package assistant

import (
	"context"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func gate(t *testing.T, pool *database.Pool, turn conversations.Turn, options GateOptions) string {
	var result string
	err := database.InTx(context.Background(), pool, func(tx database.Tx) error {
		var err error
		result, err = GateWithin(context.Background(), tx, turn, options)
		return err
	})
	if err != nil {
		t.Fatalf("gate: %v", err)
	}
	return result
}

func TestTheGateFollowsTheOldOrderOfChecks(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	contact := conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "gate"}
	first, _ := conversations.InsertCustomerMessage(ctx, pool, company, contact, conversations.IncomingMessage{ID: "44444444-4444-4444-8444-444444444444", BodyEncrypted: "v1:x:y:z", ChannelMessageID: "g1"})
	if got := gate(t, pool, *first, GateOptions{RequireNewest: true}); got != GateMay {
		t.Fatalf("a fresh message: %s", got)
	}
	second, _ := conversations.InsertCustomerMessage(ctx, pool, company, contact, conversations.IncomingMessage{ID: "55555555-5555-4555-8555-555555555555", BodyEncrypted: "v1:x:y:z", ChannelMessageID: "g2"})
	if got := gate(t, pool, *first, GateOptions{RequireNewest: true}); got != GateNotNewest {
		t.Fatalf("an older message: %s", got)
	}
	database.InTx(ctx, pool, func(tx database.Tx) error { return MarkHandledWithin(ctx, tx, *second) })
	if got := gate(t, pool, *second, GateOptions{RequireNewest: true}); got != GateHandled {
		t.Fatalf("handled: %s", got)
	}
	owner := database.TestOwner(t, pool, companyID)
	if _, err := pool.Exec(ctx, `UPDATE conversations SET handled_by = 'person', taken_over_by_user_id = $2, taken_over_at = now() WHERE company_id = $1`, companyID, owner); err != nil {
		t.Fatalf("taking over: %v", err)
	}
	if got := gate(t, pool, *second, GateOptions{AllowHandled: true}); got != GateTakenOver {
		t.Fatalf("taken over: %s", got)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO assistant_settings (company_id, status) VALUES ($1, 'paused')`, companyID); err != nil {
		t.Fatalf("pausing: %v", err)
	}
	if got := gate(t, pool, *second, GateOptions{AllowHandled: true}); got != GatePaused {
		t.Fatalf("paused: %s", got)
	}
}
