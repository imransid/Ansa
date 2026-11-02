package assistant

import (
	"context"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// callHandOver is a handover on a live call (handOver sends every call's
// here): the caller hears the AI's own checked words when it wrote some,
// else the holding reply (or, with a request open already, ansa's "I'll
// pass that on"), and the call goes on. A request is opened (routed, ansa's
// line, the owners' alert) only when none is open in the conversation, so a
// call opens one at most: what else the caller says joins it in the call's
// note. ONE transaction that takes the company row lock first (as every
// routing does) and checks the turn again.
func (r *Runner) callHandOver(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs, h Handover) error {
	messageID, err := conversations.NewID()
	if err != nil {
		return err
	}
	return database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, turn.CompanyID); err != nil {
			return err
		}
		gate, err := GateWithin(ctx, tx, turn, GateOptions{Lock: true, OnACall: true, AllowHandled: h.Reason == "send_failed"})
		if err != nil || gate != GateMay {
			return err
		}
		open, err := openRequestWithin(ctx, tx, turn.CompanyID, turn.ConversationID)
		if err != nil {
			return err
		}
		text, holding := callerHears(h, inputs, open)
		if err := sayWithin(ctx, tx, r.Box, turn, messageID, WithAILabel(text, inputs.Name, inputs.Kind, info.FirstAutomated)); err != nil {
			return err
		}
		if err := MarkHandledWithin(ctx, tx, turn); err != nil || open {
			return err
		}
		fields, err := requestFields(ctx, tx, turn, info, h)
		if err != nil {
			return err
		}
		if _, err := tickets.CreateChatTicketWithin(ctx, tx, turn.CompanyID, fields); err != nil {
			return err
		}
		if err := recordActivity(ctx, tx, turn, "handed_over", h.Reason); err != nil {
			return err
		}
		return enqueueAlert(ctx, tx, turn, h.Reason, holding, messageID)
	})
}

// callerHears is what ansa says in a call's handover, and whether it is the
// holding reply (the owners' alert says what the caller heard).
func callerHears(h Handover, inputs *Inputs, requestOpen bool) (string, bool) {
	switch {
	case h.CallerHears != "":
		return h.CallerHears, false
	case !requestOpen:
		return inputs.HoldingReply, true
	}
	return MessageTakenText(inputs.Kind, inputs.Name), false
}

// CallMessagesLeftWithin opens a request for what a caller said while ansa
// only took messages, now that their call has ended (callID), unless a
// request is open in the conversation already (it needs a person anyway):
// routed like every new request, ansa's activity line, and the owners'
// alert. Inside the caller's transaction, which took the company row lock
// first (as every routing does). The caller's words stay in the
// conversation; the call's note (call_summary.go) joins the request after.
func CallMessagesLeftWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, callID string) error {
	open, err := openRequestWithin(ctx, tx, company, conversationID)
	if err != nil || open {
		return err
	}
	name, err := callerNameWithin(ctx, tx, company, conversationID)
	if err != nil {
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

// callerNameWithin is the caller's name as the line gave it (nil = unknown).
func callerNameWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) (*string, error) {
	const statement = `
		SELECT contacts.display_name
		FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2`
	var name *string
	err := tx.QueryRow(ctx, statement, company.String(), conversationID).Scan(&name)
	return name, err
}

// openRequestWithin: is a request open in the conversation?
func openRequestWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) (bool, error) {
	const statement = `SELECT EXISTS (SELECT 1 FROM tickets WHERE company_id = $1 AND conversation_id = $2 AND status = 'open')`
	var open bool
	err := tx.QueryRow(ctx, statement, company.String(), conversationID).Scan(&open)
	return open, err
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

// sayOnTurn saves ansa's own words for the caller's turn and records that
// the turn was answered, in ONE transaction that checks the turn again.
func (r *Runner) sayOnTurn(ctx context.Context, turn conversations.Turn, text string) error {
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	return database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		gate, err := GateWithin(ctx, tx, turn, GateOptions{RequireNewest: true, Lock: true, OnACall: true})
		if err != nil || gate != GateMay {
			return err
		}
		if err := sayWithin(ctx, tx, r.Box, turn, id, text); err != nil {
			return err
		}
		return MarkHandledWithin(ctx, tx, turn)
	})
}

// sayWithin saves one of ansa's spoken sentences (sent: the call speaks it).
func sayWithin(ctx context.Context, tx database.Tx, box *secure.Box, turn conversations.Turn, id, text string) error {
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
