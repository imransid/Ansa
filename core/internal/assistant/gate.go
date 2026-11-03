package assistant

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
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
// AllowHandled (the assistant's own reply just failed to send), OnACall (a
// live call's turn: a caller on the line is always answered, so being
// paused, a person handling the conversation or an open request don't stop
// it; AnswerCall decides what ansa may say then).
type GateOptions struct {
	RequireNewest bool
	Lock          bool
	AllowHandled  bool
	OnACall       bool
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
	case status == "paused" && !options.OnACall:
		return GatePaused, nil
	case handledBy == "person" && !options.OnACall:
		return GateTakenOver, nil
	case handledMessageID == turn.TriggerMessageID && !options.AllowHandled:
		return GateHandled, nil
	}
	openRequest, err := openRequestWithin(ctx, tx, turn.CompanyID, turn.ConversationID)
	if err != nil {
		return "", err
	}
	if openRequest && !options.OnACall {
		return GateNeedsPerson, nil
	}
	if options.RequireNewest {
		newest, err := isNewestCustomerMessageWithin(ctx, tx, turn)
		if err != nil {
			return "", err
		}
		if !newest {
			return GateNotNewest, nil
		}
	}
	return GateMay, nil
}

// isNewestCustomerMessageWithin: the turn's message is the customer's newest
// in its conversation (a newer one gets its own run).
func isNewestCustomerMessageWithin(ctx context.Context, tx database.Tx, turn conversations.Turn) (bool, error) {
	newestID, _, err := newestCustomerMessageWithin(ctx, tx, turn.CompanyID, turn.ConversationID)
	return newestID == turn.TriggerMessageID, err
}

// newestCustomerMessageWithin is the customer's newest message ("" when
// they wrote none) and when it arrived.
func newestCustomerMessageWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) (string, time.Time, error) {
	const statement = `
		SELECT id, created_at FROM messages
		WHERE company_id = $1 AND conversation_id = $2 AND direction = 'in' AND body_encrypted IS NOT NULL
		ORDER BY created_at DESC LIMIT 1`
	var id string
	var at time.Time
	err := tx.QueryRow(ctx, statement, company.String(), conversationID).Scan(&id, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, nil
	}
	return id, at, err
}

// MarkHandledWithin records that the assistant answered (or decided about)
// the trigger message: it is never answered twice.
func MarkHandledWithin(ctx context.Context, tx database.Tx, turn conversations.Turn) error {
	_, err := tx.Exec(ctx, `UPDATE conversations SET assistant_handled_message_id = $3 WHERE company_id = $1 AND id = $2`, turn.CompanyID.String(), turn.ConversationID, turn.TriggerMessageID)
	return err
}
