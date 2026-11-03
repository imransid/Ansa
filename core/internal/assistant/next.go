package assistant

import (
	"context"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// What ansa does next with the customer's newest message, for the practice
// chat (a demo's customer side): read with the same gate and away settings
// an answer goes through (Runner.Answer), so "ansa is writing..." shows
// only when ansa will write. Nothing is written.
const (
	// ansa is answering it now (an important person: passing it on to you).
	NextAnswers = "answers"
	// ansa waits for you first ("if I haven't answered within N minutes"), until At.
	NextAnswersAt = "answers_at"
	// ansa's reply waits for a person to send it ("Ask me first").
	NextDraft = "draft"
	// ansa stays quiet: paused, a person took the conversation over, or a
	// request is open (a person answers next).
	NextPaused      = "paused"
	NextTakenOver   = "taken_over"
	NextRequestOpen = "request_open"
	// Someone marked important while their request is open: ansa told you.
	NextToldYou = "told_you"
	// "Only when I'm away", and you're available: the message is yours.
	NextYouAnswer = "you_answer"
	// Nothing to answer, or the message needed no answer.
	NextNothing = "nothing"
)

// Next is what ansa does next with the newest message, and when (At: only
// for NextAnswersAt).
type Next struct {
	What string     `json:"what"`
	At   *time.Time `json:"at"`
}

// WhatNext reads what ansa does next with the conversation's newest
// customer message (one of this company's conversations).
func WhatNext(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string, now time.Time) (Next, error) {
	availability, err := ReadAvailability(ctx, pool, company)
	if err != nil {
		return Next{}, err
	}
	next := Next{What: NextNothing}
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		messageID, sentAt, err := newestCustomerMessageWithin(ctx, tx, company, conversationID)
		if err != nil || messageID == "" {
			return err
		}
		turn := conversations.Turn{CompanyID: company, ConversationID: conversationID, TriggerMessageID: messageID}
		gate, err := GateWithin(ctx, tx, turn, GateOptions{RequireNewest: true})
		if err != nil {
			return err
		}
		next, err = nextAfterGate(ctx, tx, turn, gate, availability, sentAt, now)
		return err
	})
	return next, err
}

// nextAfterGate is what the gate's answer means for the message.
func nextAfterGate(ctx context.Context, tx database.Tx, turn conversations.Turn, gate string, availability Availability, sentAt, now time.Time) (Next, error) {
	switch gate {
	case GatePaused:
		return Next{What: NextPaused}, nil
	case GateTakenOver:
		return Next{What: NextTakenOver}, nil
	case GateHandled:
		return nextAfterHandled(ctx, tx, turn)
	case GateNeedsPerson:
		return nextWhileRequestOpen(ctx, tx, turn)
	case GateMay:
		return nextWhenItMay(ctx, tx, turn, availability, sentAt, now)
	}
	return Next{What: NextNothing}, nil
}

// nextAfterHandled: ansa decided about the message already: its reply
// waits for a person, a request covers it, or it needed no answer.
func nextAfterHandled(ctx context.Context, tx database.Tx, turn conversations.Turn) (Next, error) {
	const draft = `SELECT EXISTS (SELECT 1 FROM messages WHERE company_id = $1 AND conversation_id = $2 AND author = 'assistant' AND send_status = 'draft')`
	var drafted bool
	if err := tx.QueryRow(ctx, draft, turn.CompanyID.String(), turn.ConversationID).Scan(&drafted); err != nil {
		return Next{}, err
	}
	if drafted {
		return Next{What: NextDraft}, nil
	}
	open, err := openRequestWithin(ctx, tx, turn.CompanyID, turn.ConversationID)
	if err != nil || !open {
		return Next{What: NextNothing}, err
	}
	return nextWhileRequestOpen(ctx, tx, turn)
}

// nextWhileRequestOpen: a person answers next; an important person's
// message was passed on to you all the same.
func nextWhileRequestOpen(ctx context.Context, tx database.Tx, turn conversations.Turn) (Next, error) {
	important, err := isImportantWithin(ctx, tx, turn)
	if err != nil {
		return Next{}, err
	}
	if important {
		return Next{What: NextToldYou}, nil
	}
	return Next{What: NextRequestOpen}, nil
}

// nextWhenItMay follows the away settings, as Runner.Answer does: an
// important person is passed on at once; otherwise ansa answers now, waits
// for you until its time, or leaves the message to you.
func nextWhenItMay(ctx context.Context, tx database.Tx, turn conversations.Turn, availability Availability, sentAt, now time.Time) (Next, error) {
	important, err := isImportantWithin(ctx, tx, turn)
	if err != nil {
		return Next{}, err
	}
	cover, minutes := DecideCover(availability, now)
	switch {
	case important || cover == CoverAnswer:
		return Next{What: NextAnswers}, nil
	case cover == CoverLeave:
		return Next{What: NextYouAnswer}, nil
	}
	var due *time.Time
	const statement = `SELECT assistant_due_at FROM conversations WHERE company_id = $1 AND id = $2`
	if err := tx.QueryRow(ctx, statement, turn.CompanyID.String(), turn.ConversationID).Scan(&due); err != nil {
		return Next{}, err
	}
	// Before the run set the wait (it starts a moment after the message).
	if due == nil {
		at := sentAt.Add(time.Duration(minutes) * time.Minute)
		due = &at
	}
	if !due.After(now) {
		return Next{What: NextAnswers}, nil
	}
	return Next{What: NextAnswersAt, At: due}, nil
}

// isImportantWithin: the conversation's contact is someone the owner marked important.
func isImportantWithin(ctx context.Context, tx database.Tx, turn conversations.Turn) (bool, error) {
	const statement = `
		SELECT contacts.important FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2`
	var important bool
	err := tx.QueryRow(ctx, statement, turn.CompanyID.String(), turn.ConversationID).Scan(&important)
	return important, err
}
