package assistant

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
)

// Why the assistant stays quiet, or GateMay when it may answer (the same
// order of checks as the old db/assistant-runs.ts gateWithin).
const (
	GateMay         = "may"
	GatePaused      = "paused"
	GateTakenOver   = "taken-over"
	GateNeedsPerson = "needs-person"
	GateNotNewest   = "not-newest"
	GateHandled     = "handled"
	GateNotFound    = "not-found"
)

// GateOptions: RequireNewest (a newer message gets its own run), Lock (a
// write follows: the conversation row is locked until the transaction ends),
// AllowHandled (the assistant's own reply just failed to send).
type GateOptions struct {
	RequireNewest bool
	Lock          bool
	AllowHandled  bool
}

// GateWithin decides, inside tx, whether the assistant may answer the turn.
func GateWithin(ctx context.Context, tx database.Tx, turn conversations.Turn, options GateOptions) (string, error) {
	company := turn.CompanyID.String()
	conversation := `SELECT handled_by, COALESCE(assistant_handled_message_id::text, '') FROM conversations WHERE company_id = $1 AND id = $2`
	if options.Lock {
		conversation += ` FOR UPDATE`
	}
	var handledBy, handledMessageID string
	err := tx.QueryRow(ctx, conversation, company, turn.ConversationID).Scan(&handledBy, &handledMessageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return GateNotFound, nil
	}
	if err != nil {
		return "", err
	}
	var status string
	err = tx.QueryRow(ctx, `SELECT status FROM assistant_settings WHERE company_id = $1 FOR SHARE`, company).Scan(&status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	switch {
	case status == "paused":
		return GatePaused, nil
	case handledBy == "person":
		return GateTakenOver, nil
	case handledMessageID == turn.TriggerMessageID && !options.AllowHandled:
		return GateHandled, nil
	}
	var openRequest bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM tickets WHERE company_id = $1 AND conversation_id = $2 AND status = 'open')`, company, turn.ConversationID).Scan(&openRequest); err != nil {
		return "", err
	}
	if openRequest {
		return GateNeedsPerson, nil
	}
	if options.RequireNewest {
		const newest = `
			SELECT id FROM messages
			WHERE company_id = $1 AND conversation_id = $2 AND direction = 'in' AND body_encrypted IS NOT NULL
			ORDER BY created_at DESC LIMIT 1`
		var newestID string
		if err := tx.QueryRow(ctx, newest, company, turn.ConversationID).Scan(&newestID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		if newestID != turn.TriggerMessageID {
			return GateNotNewest, nil
		}
	}
	return GateMay, nil
}

// MarkHandledWithin records that the assistant answered (or decided about)
// the trigger message: it is never answered twice.
func MarkHandledWithin(ctx context.Context, tx database.Tx, turn conversations.Turn) error {
	_, err := tx.Exec(ctx, `UPDATE conversations SET assistant_handled_message_id = $3 WHERE company_id = $1 AND id = $2`, turn.CompanyID.String(), turn.ConversationID, turn.TriggerMessageID)
	return err
}
