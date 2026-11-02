package assistant

import (
	"context"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// A live phone call (step 55): the caller's words are the newest message of
// their phone conversation, and ansa answers at once with the same brain,
// checks, orders and handovers as in a chat. Its words are saved in the
// conversation and spoken on the call (core/internal/phone reads them back).
// When ansa may not answer itself (paused, a person handling the
// conversation, a request already open), it takes a message instead.

// CallAnswer is what ansa says after the caller's words.
type CallAnswer struct {
	// What to say, in order: a reply, ansa's order texts, the holding reply.
	Words []string
	// ansa only took a message (no AI): the caller's words wait for a person.
	TookMessage bool
}

// After a thank-you the AI needn't answer in a chat; on a call silence is
// rude, so ansa keeps the line open.
const anythingElseText = "Is there anything else I can help you with?"

// AnswerCall answers the caller's words (turn) on a live call: whatever the
// away settings say (a call reaches ansa only when the person couldn't
// answer), never as a draft.
func (r *Runner) AnswerCall(ctx context.Context, turn conversations.Turn) (CallAnswer, error) {
	outcome, err := r.answer(ctx, turn, answerOptions{coverAfterNoReply: true, onACall: true})
	if err != nil {
		return CallAnswer{}, err
	}
	words, err := SpokenAfter(ctx, r.Pool, r.Box, turn)
	if err != nil || len(words) > 0 {
		return CallAnswer{Words: words}, err
	}
	kind, name, err := ReadCallVoice(ctx, r.Pool, turn.CompanyID)
	if err != nil {
		return CallAnswer{}, err
	}
	answer := CallAnswer{Words: []string{anythingElseText}}
	if outcome == OutcomeQuiet {
		answer = CallAnswer{Words: []string{MessageTakenText(kind, name)}, TookMessage: true}
	}
	return answer, r.sayAndMarkHandled(ctx, turn, answer.Words[0])
}

// MayAnswerCall: may ansa itself answer a call in this conversation now (not
// paused, nobody handling it, no request open)? Otherwise it takes messages.
func MayAnswerCall(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) (bool, error) {
	may := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		turn := conversations.Turn{CompanyID: company, ConversationID: conversationID}
		gate, err := GateWithin(ctx, tx, turn, GateOptions{AllowHandled: true})
		may = gate == GateMay
		return err
	})
	return may, err
}

// CallMessagesLeftWithin opens a request for what a caller said while ansa
// only took messages, now that their call has ended (callID), unless a
// request is open in the conversation already (it needs a person anyway):
// routed like every new request, ansa's activity line, and the owners'
// alert. Inside the caller's transaction, which took the company row lock
// first (as every routing does). The words stay in the conversation: the
// request names no more than who called.
func CallMessagesLeftWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, callID string) error {
	const statement = `
		SELECT contacts.display_name,
			EXISTS (SELECT 1 FROM tickets WHERE tickets.company_id = $1 AND tickets.conversation_id = $2 AND tickets.status = 'open')
		FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2`
	var name *string
	var openRequest bool
	if err := tx.QueryRow(ctx, statement, company.String(), conversationID).Scan(&name, &openRequest); err != nil || openRequest {
		return err
	}
	fields := tickets.NewChatTicket{
		Channel:        conversations.ChannelPhone,
		Subject:        "A caller left a message",
		Description:    ReasonText["call_message"] + " Their words are in the conversation.",
		CustomerName:   name,
		ConversationID: conversationID,
	}
	if _, err := tickets.CreateChatTicketWithin(ctx, tx, company, fields); err != nil {
		return err
	}
	// The call's id names this alert (one per call).
	turn := conversations.Turn{CompanyID: company, ConversationID: conversationID, TriggerMessageID: callID}
	if err := recordActivity(ctx, tx, turn, "handed_over", "call_message"); err != nil {
		return err
	}
	return enqueueAlert(ctx, tx, turn, "call_message", false, "")
}

// MessageTakenText is what ansa says when it takes a caller's message.
func MessageTakenText(kind, name string) string {
	if kind == "personal" {
		return "Thank you, I'll pass that on to " + displayName(name, "them") + ". Is there anything else?"
	}
	return "Thank you, I've noted that and the team will get back to you. Is there anything else?"
}

// ReadCallVoice is who ansa speaks for: the company's kind ("business" or
// "personal") and its name as the assistant says it (the confirmed
// company_name fact, else the company's own name).
func ReadCallVoice(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (kind, name string, err error) {
	if err := pool.QueryRow(ctx, `SELECT kind, name FROM companies WHERE id = $1`, company.String()).Scan(&kind, &name); err != nil {
		return "", "", err
	}
	facts, err := readFacts(ctx, pool, company)
	if err != nil {
		return "", "", err
	}
	return kind, firstNonEmpty(facts["company_name"], name), nil
}

// SayOnCall saves words ansa says on a call by itself (the greeting): spoken
// at once, as the assistant's, so the next automated message needs no AI
// label (the greeting says it).
func SayOnCall(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID, text string) error {
	turn := conversations.Turn{CompanyID: company, ConversationID: conversationID}
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		return sayWithin(ctx, tx, box, turn, text)
	})
}

// SpokenAfter is what ansa said after the caller's words (turn), in order.
func SpokenAfter(ctx context.Context, pool *database.Pool, box *secure.Box, turn conversations.Turn) ([]string, error) {
	const statement = `
		SELECT id, body_encrypted FROM messages
		WHERE company_id = $1 AND conversation_id = $2 AND direction = 'out' AND author = 'assistant'
			AND body_encrypted IS NOT NULL AND send_status IN ('sending', 'sent')
			AND created_at > (SELECT created_at FROM messages WHERE company_id = $1 AND id = $3)
		ORDER BY created_at`
	rows, err := pool.Query(ctx, statement, turn.CompanyID.String(), turn.ConversationID, turn.TriggerMessageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	words := []string{}
	for rows.Next() {
		var id, body string
		if err := rows.Scan(&id, &body); err != nil {
			return nil, err
		}
		text, err := box.Decrypt(body, conversations.MessageContext(turn.CompanyID, id))
		if err != nil {
			return nil, err
		}
		words = append(words, text)
	}
	return words, rows.Err()
}

// sayAndMarkHandled saves ansa's own words for the caller's turn and records
// that the turn was answered.
func (r *Runner) sayAndMarkHandled(ctx context.Context, turn conversations.Turn, text string) error {
	return database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		if err := sayWithin(ctx, tx, r.Box, turn, text); err != nil {
			return err
		}
		return MarkHandledWithin(ctx, tx, turn)
	})
}

// sayWithin saves one of ansa's own spoken sentences (sent: the call speaks it).
func sayWithin(ctx context.Context, tx database.Tx, box *secure.Box, turn conversations.Turn, text string) error {
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	body, err := box.Encrypt(text, conversations.MessageContext(turn.CompanyID, id))
	if err != nil {
		return err
	}
	if err := insertOutgoing(ctx, tx, turn, id, body, "sent"); err != nil {
		return err
	}
	return touchWithin(ctx, tx, turn)
}

// displayName is the name as written, or `fallback` when there is none.
func displayName(name, fallback string) string {
	if clean := firstNonEmpty(name); clean != "" {
		return clean
	}
	return fallback
}
