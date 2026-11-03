package phone

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/packages"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// startCall opens a live call in the conversation, in ONE transaction that
// takes the company row lock first (as endCall) and ends a call left live
// there (a page closed or left without hanging up) as hanging up would:
// one live call per conversation (phone_calls_one_live_per_conversation).
func startCall(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID, line string) (string, error) {
	var callID string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		leftLive, err := liveCallsWithin(ctx, tx, company, conversationID)
		if err != nil {
			return err
		}
		for _, id := range leftLive {
			if err := endCallWithin(ctx, tx, company, id); err != nil {
				return err
			}
		}
		const insert = `INSERT INTO phone_calls (company_id, conversation_id, line) VALUES ($1, $2, $3) RETURNING id`
		return tx.QueryRow(ctx, insert, company.String(), conversationID, line).Scan(&callID)
	})
	return callID, err
}

// liveCallsWithin are the ids of the conversation's live calls (one at most).
func liveCallsWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) ([]string, error) {
	const statement = `SELECT id FROM phone_calls WHERE company_id = $1 AND conversation_id = $2 AND ended_at IS NULL`
	rows, err := tx.Query(ctx, statement, company.String(), conversationID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
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

// endCall hangs up the live call (endCallWithin), in ONE transaction that
// takes the company row lock first.
func endCall(ctx context.Context, pool *database.Pool, company tenant.CompanyID, callID string) error {
	if !uuidPattern.MatchString(callID) {
		return nil
	}
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		return endCallWithin(ctx, tx, company, callID)
	})
}

// endCallWithin ends the live call, counts its minutes, queues its note and
// opens a request for the messages it took, inside the caller's transaction,
// which took the company row lock first (the request is routed, as every
// routing does). Only the live call is ended, once.
func endCallWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, callID string) error {
	const end = `
		UPDATE phone_calls SET ended_at = now()
		WHERE company_id = $1 AND id = $2 AND ended_at IS NULL
		RETURNING conversation_id, messages_taken, started_at, ended_at`
	var conversationID string
	var messagesTaken int
	var started, ended time.Time
	err := tx.QueryRow(ctx, end, company.String(), callID).Scan(&conversationID, &messagesTaken, &started, &ended)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// The call's minutes count against the package (step 57), once: only the live call ends.
	if err := packages.AddCallSecondsWithin(ctx, tx, company, started, int(ended.Sub(started).Seconds())); err != nil {
		return err
	}
	// Queued once: only the live call is ended.
	note := jobs.NewJob{Kind: assistant.CallSummaryJobKind, Payload: assistant.CallSummaryPayload{CallID: callID}}
	if _, err := jobs.EnqueueWithin(ctx, tx, company, note); err != nil {
		return err
	}
	if messagesTaken == 0 {
		return nil
	}
	return assistant.CallMessagesLeftWithin(ctx, tx, company, conversationID, callID)
}
