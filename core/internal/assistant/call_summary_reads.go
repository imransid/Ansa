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

// The reads behind a call's note (call_summary.go): the finished call's
// words, who called and the orders it placed.

// finishedCall is an ended call: its conversation, when it started and
// ended, its lines in order (ansa's greeting first), the caller's name as
// the line gave it (nil = none) and the numbers of the orders placed on it.
type finishedCall struct {
	ID, ConversationID string
	StartedAt, EndedAt time.Time
	Lines              []Line
	CallerName         *string
	OrdersPlaced       []int
}

// readFinishedCall reads an ended call; nil when it isn't over or the
// caller said nothing. A line that can't be decrypted is left out.
func readFinishedCall(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, callID string) (*finishedCall, error) {
	call := &finishedCall{ID: callID}
	const statement = `SELECT conversation_id, started_at, ended_at FROM phone_calls WHERE company_id = $1 AND id = $2 AND ended_at IS NOT NULL`
	err := pool.QueryRow(ctx, statement, company.String(), callID).Scan(&call.ConversationID, &call.StartedAt, &call.EndedAt)
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
	rows, err := pool.Query(ctx, words, company.String(), call.ConversationID, call.StartedAt, call.EndedAt)
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
	if call.CallerName, err = callerName(ctx, pool, company, call.ConversationID); err != nil {
		return nil, err
	}
	call.OrdersPlaced, err = ordersPlacedDuring(ctx, pool, company, call)
	return call, err
}

// callerName is the name the phone line gave the caller (nil = none).
func callerName(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) (*string, error) {
	const statement = `
		SELECT contacts.display_name FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2`
	var name *string
	err := pool.QueryRow(ctx, statement, company.String(), conversationID).Scan(&name)
	return name, err
}

// ordersPlacedDuring are the numbers of the orders ansa placed on the call
// (at most the brain's 20): done already, so the note knows they wait for
// nobody.
func ordersPlacedDuring(ctx context.Context, pool *database.Pool, company tenant.CompanyID, call *finishedCall) ([]int, error) {
	const statement = `
		SELECT order_number FROM orders
		WHERE company_id = $1 AND conversation_id = $2 AND placed_at BETWEEN $3 AND $4
		ORDER BY order_number LIMIT 20`
	rows, err := pool.Query(ctx, statement, company.String(), call.ConversationID, call.StartedAt, call.EndedAt)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int])
}

// firstAndLastLines keeps a long call's first and newest lines.
func firstAndLastLines(lines []Line) []Line {
	if len(lines) <= callNoteFirstLines+callNoteLastLines {
		return lines
	}
	kept := append([]Line{}, lines[:callNoteFirstLines]...)
	return append(kept, lines[len(lines)-callNoteLastLines:]...)
}
