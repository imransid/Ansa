package assistant

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/team"
	"ansa/core/internal/tickets"
)

// AlertJobKind tells the owners a conversation needs them, as a job, so an
// alert is never lost. It starts after the holding reply's send had its
// time (telegram's 15 s), so it can say whether the customer got it.
const AlertJobKind = "owner.alert"

const alertDelay = 20 * time.Second

// Handover is one handover's details.
type Handover struct {
	Reason string
	// The AI's own words, when it asked for a person itself.
	Subject, Summary, CategoryName string
	// False when the reply itself just failed to send: no holding reply then.
	SendHoldingReply bool
}

// AlertPayload is what the owners' alert reads.
type AlertPayload struct {
	ConversationID string `json:"conversationId"`
	Reason         string `json:"reason"`
	// The holding reply's message ("" = none was sent).
	HoldingMessageID string `json:"holdingMessageId"`
}

// handOver hands the conversation to a person (the old
// services/assistant-handover.ts): the business's holding reply (never the
// AI's text), a request opened and routed like every new one, the activity
// line and the owners' alert, in ONE transaction that takes the company row
// lock first (as every routing does) and checks the conversation again. A
// newer message meanwhile doesn't stop it: the customer still waits.
func (r *Runner) handOver(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs, h Handover) error {
	holdingID, err := conversations.NewID()
	if err != nil {
		return err
	}
	holdingText := WithAILabel(inputs.HoldingReply, inputs.Name, inputs.Kind, info.FirstAutomated)
	var target chat.Target
	holdingSaved := false
	err = database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, turn.CompanyID); err != nil {
			return err
		}
		gate, err := GateWithin(ctx, tx, turn, GateOptions{Lock: true, AllowHandled: h.Reason == "send_failed"})
		if err != nil || gate != GateMay {
			return err
		}
		if h.SendHoldingReply {
			if holdingSaved, target, err = r.saveHoldingReply(ctx, tx, turn, holdingID, holdingText); err != nil {
				return err
			}
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
		if err := MarkHandledWithin(ctx, tx, turn); err != nil {
			return err
		}
		if err := touchWithin(ctx, tx, turn); err != nil {
			return err
		}
		return enqueueAlert(ctx, tx, turn, h.Reason, holdingSaved, holdingID)
	})
	if err != nil || !holdingSaved {
		return err
	}
	return chat.RecordDelivery(ctx, r.Pool, turn.CompanyID, holdingID, r.Chat.Send(ctx, target, holdingID, holdingText))
}

// saveHoldingReply saves the holding reply "sending" when the channel can
// take a message now; it reports whether it saved one, and where it goes.
func (r *Runner) saveHoldingReply(ctx context.Context, tx database.Tx, turn conversations.Turn, id, text string) (bool, chat.Target, error) {
	target, refusal, err := chat.RouteWithin(ctx, tx, turn.CompanyID, turn.ConversationID)
	if err != nil || refusal != "" {
		return false, chat.Target{}, err
	}
	body, err := r.Box.Encrypt(text, conversations.MessageContext(turn.CompanyID, id))
	if err != nil {
		return false, chat.Target{}, err
	}
	return true, target, insertOutgoing(ctx, tx, turn, id, body, "sending")
}

func enqueueAlert(ctx context.Context, tx database.Tx, turn conversations.Turn, reason string, holdingSaved bool, holdingID string) error {
	payload := AlertPayload{ConversationID: turn.ConversationID, Reason: reason}
	if holdingSaved {
		payload.HoldingMessageID = holdingID
	}
	job := jobs.NewJob{Kind: AlertJobKind, Payload: payload, RunAfter: time.Now().Add(alertDelay), DedupeKey: "alert:" + turn.TriggerMessageID + ":" + reason}
	_, err := jobs.EnqueueWithin(ctx, tx, turn.CompanyID, job)
	if errors.Is(err, jobs.ErrDuplicate) {
		return nil
	}
	return err
}

// requestFields is the request a person sees: the AI's subject and summary
// when it wrote them, fixed words otherwise; always the reason first. The
// ticket rules apply (one plain line of 1-200): a subject they refuse falls
// back to the fixed one, a name they refuse is left out.
func requestFields(ctx context.Context, tx database.Tx, turn conversations.Turn, info conversationInfo, h Handover) (tickets.NewChatTicket, error) {
	subject := plaintext.SingleLine(h.Subject)
	if subject == "" || utf8.RuneCountInString(subject) > 200 {
		subject = ChannelLabels[info.Channel] + " conversation needs you"
	}
	description := ReasonText[h.Reason]
	if summary := strings.TrimSpace(h.Summary); summary != "" {
		description += "\n\n" + cutRunes(summary, 1_000)
	}
	var name *string
	if info.ContactName != nil {
		if cleaned := plaintext.SingleLine(*info.ContactName); cleaned != "" && utf8.RuneCountInString(cleaned) <= 200 {
			name = &cleaned
		}
	}
	categoryID, err := activeCategoryID(ctx, tx, turn, h.CategoryName)
	return tickets.NewChatTicket{Subject: subject, Description: description, CategoryID: categoryID, CustomerName: name, ConversationID: info.ConversationID}, err
}

// activeCategoryID is the id of the company's active category with this
// exact name, or "" (the AI may only name one of them).
func activeCategoryID(ctx context.Context, tx database.Tx, turn conversations.Turn, name string) (string, error) {
	if name == "" {
		return "", nil
	}
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM categories WHERE company_id = $1 AND name = $2 AND archived_at IS NULL`, turn.CompanyID.String(), name).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func cutRunes(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return string([]rune(text)[:max])
}
