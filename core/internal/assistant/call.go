package assistant

import (
	"context"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// A live phone call (step 55): the caller's words are the newest message of
// their phone conversation, and ansa answers at once with the same brain,
// checks, orders and handovers as in a chat, for the WHOLE call: a request
// opened during the call doesn't stop it, since the caller is still on the
// line (the call's note joins the request when it ends: call_summary.go).
// When ansa may not answer on anyone's behalf (the assistant paused, a
// person handling the conversation, a caller marked important), the AI only
// takes a message: who is calling, what about, how and when to reach them.
// Its words are saved in the conversation and spoken on the call.

// CallAnswer is what ansa says after the caller's words.
type CallAnswer struct {
	// What to say, in order: a reply, ansa's order texts, a handover's words.
	Words []string
	// ansa only took a message: the caller's words wait for a person (a
	// request is opened when the call ends, unless one is open).
	TookMessage bool
}

// After a thank-you the AI needn't answer in a chat; on a call silence is
// rude, so ansa keeps the line open.
const anythingElseText = "Is there anything else I can help you with?"

// The AI answers this many of one caller's turns an hour (a call has many
// more turns than a chat has messages); past it, ansa only takes messages.
var callTurnLimit = ratelimit.Rule{MaxAttempts: 60, Window: time.Hour}

// AnswerCall answers the caller's words (turn) on a live call: whatever the
// away settings say (a call reaches ansa only when the person couldn't
// answer), never as a draft.
func (r *Runner) AnswerCall(ctx context.Context, turn conversations.Turn) (CallAnswer, error) {
	gate, info, err := r.readGate(ctx, turn, GateOptions{RequireNewest: true, OnACall: true})
	if err != nil {
		return CallAnswer{}, err
	}
	if gate != GateMay {
		// A newer turn is answered on its own; an answered one says it again.
		words, err := SpokenAfter(ctx, r.Pool, r.Box, turn)
		return CallAnswer{Words: words}, err
	}
	messageOnly, err := CallTakesMessagesOnly(ctx, r.Pool, turn.CompanyID, turn.ConversationID)
	if err != nil {
		return CallAnswer{}, err
	}
	if over, err := r.overCallLimits(ctx, turn); err != nil || over {
		if err != nil {
			return CallAnswer{}, err
		}
		return r.takeMessageWithoutAI(ctx, turn)
	}
	inputs, err := GatherInputs(ctx, r.Pool, r.Box, turn.CompanyID, turn.ConversationID, r.now())
	if err != nil {
		return CallAnswer{}, err
	}
	if err := inputs.AddKnowledge(ctx, r.Pool, turn.CompanyID); err != nil {
		return CallAnswer{}, err
	}
	inputs.onACall(messageOnly)
	if err := r.answerCallTurn(ctx, turn, info, inputs, messageOnly); err != nil {
		return CallAnswer{}, err
	}
	words, err := SpokenAfter(ctx, r.Pool, r.Box, turn)
	return CallAnswer{Words: words, TookMessage: messageOnly}, err
}

// answerCallTurn does what the AI's answer asks for on a call: its checked
// reply spoken, ansa's order steps (never while it only takes messages), or
// a handover in which the caller hears the AI's own words when they pass
// core's checks (the holding reply otherwise).
func (r *Runner) answerCallTurn(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs, messageOnly bool) error {
	decision := r.decide(ctx, inputs)
	switch {
	case decision.Kind == "reply":
		_, err := r.sendOrDraft(ctx, turn, info, inputs, decision.Text, nil)
		return err
	case decision.Kind == "no_reply":
		return r.sayOnTurn(ctx, turn, anythingElseText)
	case isOrderStep(decision.Kind) && !messageOnly:
		_, err := r.runOrderStep(ctx, turn, info, inputs, decision)
		return err
	case isOrderStep(decision.Kind):
		// Only a message now: no order is taken (the AI was told so).
		return r.handOver(ctx, turn, info, inputs, Handover{Reason: "order", SendHoldingReply: true})
	}
	handover := handoverFor(decision, inputs)
	if decision.Kind == "needs_person" && CheckReply(decision.Text, inputs.Checks) == "" {
		handover.CallerHears = decision.Text
	}
	if info.Important {
		handover.Reason = "important_person"
	}
	return r.handOver(ctx, turn, info, inputs, handover)
}

func isOrderStep(kind string) bool {
	return kind == "order_summary" || kind == "order_confirmed" || kind == "order_withdrawn"
}

// overCallLimits counts this turn against the caller's and the business's
// hourly AI answers, and checks the package's call minutes this month (step
// 57); past any, ansa only takes messages (no AI).
func (r *Runner) overCallLimits(ctx context.Context, turn conversations.Turn) (bool, error) {
	over, err := r.Limiter.Over(ctx, "assistant-call", turn.ConversationID, callTurnLimit)
	if err != nil || over {
		return over, err
	}
	over, err = r.Limiter.Over(ctx, "assistant-replies", turn.CompanyID.String(), companyReplyLimit)
	if err != nil || over {
		return over, err
	}
	left, err := r.callTimeLeft(ctx, turn)
	return !left, err
}

// takeMessageWithoutAI: ansa's fixed "I'll pass that on" (past the limits).
func (r *Runner) takeMessageWithoutAI(ctx context.Context, turn conversations.Turn) (CallAnswer, error) {
	kind, name, err := ReadCallVoice(ctx, r.Pool, turn.CompanyID)
	if err != nil {
		return CallAnswer{}, err
	}
	if err := r.sayOnTurn(ctx, turn, MessageTakenText(kind, name)); err != nil {
		return CallAnswer{}, err
	}
	words, err := SpokenAfter(ctx, r.Pool, r.Box, turn)
	return CallAnswer{Words: words, TookMessage: true}, err
}

// CallTakesMessagesOnly: may ansa only take a message on a call in this
// conversation (the assistant paused, a person handling the conversation,
// or a caller marked important)? Otherwise it helps fully, as in a chat.
func CallTakesMessagesOnly(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) (bool, error) {
	const statement = `
		SELECT COALESCE((SELECT status = 'paused' FROM assistant_settings WHERE company_id = $1), false)
			OR conversations.handled_by = 'person' OR contacts.important
		FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2`
	var only bool
	err := pool.QueryRow(ctx, statement, company.String(), conversationID).Scan(&only)
	return only, err
}

// MessageTakenText is what ansa says when it takes a caller's message
// without the AI.
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
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		return sayWithin(ctx, tx, box, turn, id, text)
	})
}
