package phone

import (
	"context"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// startCall opens a live call in the conversation, in ONE transaction that
// first ends a call left live there (a page closed without hanging up): one
// live call per conversation (phone_calls_one_live_per_conversation).
func startCall(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID, line string) (string, error) {
	var callID string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		const endLeftLive = `UPDATE phone_calls SET ended_at = now() WHERE company_id = $1 AND conversation_id = $2 AND ended_at IS NULL`
		if _, err := tx.Exec(ctx, endLeftLive, company.String(), conversationID); err != nil {
			return err
		}
		const insert = `INSERT INTO phone_calls (company_id, conversation_id, line) VALUES ($1, $2, $3) RETURNING id`
		return tx.QueryRow(ctx, insert, company.String(), conversationID, line).Scan(&callID)
	})
	return callID, err
}

// liveCall is the conversation of the company's live call with this id.
func liveCall(ctx context.Context, pool *database.Pool, company tenant.CompanyID, callID string) (string, error) {
	if !uuidPattern.MatchString(callID) {
		return "", ErrCallOver
	}
	const statement = `SELECT conversation_id FROM phone_calls WHERE company_id = $1 AND id = $2 AND ended_at IS NULL`
	var conversationID string
	err := pool.QueryRow(ctx, statement, company.String(), callID).Scan(&conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrCallOver
	}
	return conversationID, err
}

// countMessageTaken: the caller left one more message while ansa only took messages.
func countMessageTaken(ctx context.Context, pool *database.Pool, company tenant.CompanyID, callID string) error {
	const statement = `UPDATE phone_calls SET messages_taken = messages_taken + 1 WHERE company_id = $1 AND id = $2`
	_, err := pool.Exec(ctx, statement, company.String(), callID)
	return err
}

// endCall ends the live call, and opens a request for the messages it took,
// in ONE transaction that takes the company row lock first (the request is
// routed, as every routing does). Only the live call is ended, once.
func endCall(ctx context.Context, pool *database.Pool, company tenant.CompanyID, callID string) error {
	if !uuidPattern.MatchString(callID) {
		return nil
	}
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		const end = `
			UPDATE phone_calls SET ended_at = now()
			WHERE company_id = $1 AND id = $2 AND ended_at IS NULL
			RETURNING conversation_id, messages_taken`
		var conversationID string
		var messagesTaken int
		err := tx.QueryRow(ctx, end, company.String(), callID).Scan(&conversationID, &messagesTaken)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil || messagesTaken == 0 {
			return err
		}
		return assistant.CallMessagesLeftWithin(ctx, tx, company, conversationID, callID)
	})
}
