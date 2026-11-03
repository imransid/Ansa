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
	GateCallOver    = "call-over"
)

// GateOptions: RequireNewest (a newer message gets its own run), Lock (a
// write follows: the conversation row is locked until the transaction ends),
// AllowHandled (the assistant's own reply just failed to send), OnACall (a
// live call's turn: a caller on the line is always answered, so being
// paused, a person handling the conversation or an open request don't stop
// it; AnswerCall decides what ansa may say then; but once they hung up,
// nothing is said).
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
	if options.OnACall {
		live, err := callStillLiveWithin(ctx, tx, turn)
		if err != nil {
			return "", err
		}
		if !live {
			return GateCallOver, nil
		}
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

// callStillLiveWithin: is the call whose words started the turn still on?
// A caller who hung up while the AI was thinking never hears its answer, so
// nothing of it is saved: the conversation would hold words nobody heard.
// The caller's words name their call ("call:<call id>:<message id>",
// phone.Turn).
func callStillLiveWithin(ctx context.Context, tx database.Tx, turn conversations.Turn) (bool, error) {
	const statement = `
		SELECT EXISTS (
			SELECT 1 FROM messages
			JOIN phone_calls ON phone_calls.company_id = messages.company_id AND phone_calls.conversation_id = messages.conversation_id
			WHERE messages.company_id = $1 AND messages.id = $2 AND phone_calls.ended_at IS NULL
				AND messages.channel_message_id = 'call:' || phone_calls.id::text || ':' || messages.id::text)`
	var live bool
	err := tx.QueryRow(ctx, statement, turn.CompanyID.String(), turn.TriggerMessageID).Scan(&live)
	return live, err
}

// MarkHandledWithin records that the assistant answered (or decided about)
// the trigger message: it is never answered twice.
func MarkHandledWithin(ctx context.Context, tx database.Tx, turn conversations.Turn) error {
	_, err := tx.Exec(ctx, `UPDATE conversations SET assistant_handled_message_id = $3 WHERE company_id = $1 AND id = $2`, turn.CompanyID.String(), turn.ConversationID, turn.TriggerMessageID)
	return err
}
