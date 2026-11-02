package assistant

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// The reads behind a call's note (call_summary.go): the finished call's words.

// finishedCall is an ended call: its conversation, when it started, and
// its lines in order (ansa's greeting first).
type finishedCall struct {
	ID, ConversationID string
	StartedAt          time.Time
	Lines              []Line
}

// readFinishedCall reads an ended call; nil when it isn't over or the
// caller said nothing. A line that can't be decrypted is left out.
func readFinishedCall(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, callID string) (*finishedCall, error) {
	call := &finishedCall{ID: callID}
	var ended time.Time
	const statement = `SELECT conversation_id, started_at, ended_at FROM phone_calls WHERE company_id = $1 AND id = $2 AND ended_at IS NOT NULL`
	err := pool.QueryRow(ctx, statement, company.String(), callID).Scan(&call.ConversationID, &call.StartedAt, &ended)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	const words = `
		SELECT id, direction, body_encrypted FROM messages
		WHERE company_id = $1 AND conversation_id = $2 AND body_encrypted IS NOT NULL
			AND created_at >= $3 AND created_at <= $4 AND (direction = 'in' OR send_status IN ('sending', 'sent'))
		ORDER BY created_at`
	rows, err := pool.Query(ctx, words, company.String(), call.ConversationID, call.StartedAt, ended)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lines, callerSpoke := []Line{}, false
	for rows.Next() {
		var id, direction, body string
		if err := rows.Scan(&id, &direction, &body); err != nil {
			return nil, err
		}
		text, err := box.Decrypt(body, conversations.MessageContext(company, id))
		if err != nil {
			continue
		}
		sender := "restaurant"
		if direction == "in" {
			sender, callerSpoke = "customer", true
		}
		lines = append(lines, Line{Sender: sender, Text: text})
	}
	if err := rows.Err(); err != nil || !callerSpoke {
		return nil, err
	}
	call.Lines = firstAndLastLines(lines)
	return call, nil
}

// firstAndLastLines keeps a long call's first and newest lines.
func firstAndLastLines(lines []Line) []Line {
	if len(lines) <= callNoteFirstLines+callNoteLastLines {
		return lines
	}
	kept := append([]Line{}, lines[:callNoteFirstLines]...)
	return append(kept, lines[len(lines)-callNoteLastLines:]...)
}
