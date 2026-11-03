package comments

import (
	"strings"
	"unicode/utf8"

	"ansa/core/internal/assistant"
	"ansa/core/internal/plaintext"
)

// plan is what core decided to do with a comment: nothing (skipped), or a
// public reply and/or a private message, and maybe a request for a person.
type plan struct {
	Kind       string
	SkipReason string
	// The texts to send ("" = none), each "sending" or (Ask me first) "waiting".
	Public, Private             string
	PublicStatus, PrivateStatus string
	Handover                    *handover
}

// handover is the request a person follows up.
type handover struct {
	Reason, Subject, Summary, Category string
}

// planInputs is what core decides with.
type planInputs struct {
	Checks assistant.CheckData
	// The business's name and kind (the AI label), and its holding reply.
	Name, AccountKind, HoldingReply string
	// "automatic" or "ask_first".
	ReplyMode string
	// The comment's language (orders.LanguageOf) and Meta's id for it (the
	// fixed texts are picked by it).
	Language, CommentID string
}

// planFor turns the brain's proposal into what core sends (the brain never
// acts): a question answered in public with the AI's text, after ansa's
// checks; an order (a price, or wanting to order) a fixed public note and
// the AI's private message, after the same checks; a complaint, a text the
// checks stop, or anything ansa is unsure of (the AI failed too) a fixed
// public note, the holding reply in private and a request; praise and spam
// nothing. In "Ask me first" the AI's own texts wait for a person (an
// order's public note with its private message: it announces it); ansa's
// fixed texts and the holding reply never wait.
func planFor(answer BrainAnswer, in planInputs) plan {
	switch answer.Kind {
	case KindThanks, KindSpam:
		return plan{Kind: answer.Kind, SkipReason: answer.Kind}
	case KindQuestion:
		reply := oneLine(answer.PublicReply)
		if reason := checkText(reply, PublicReplyMax, in.Checks); reason != "" {
			return handOverPlan(in, KindUnsure, handover{Reason: reason})
		}
		return plan{Kind: KindQuestion, Public: reply, PublicStatus: in.aiTextStatus()}
	case KindOrder:
		message := strings.TrimSpace(answer.PrivateMessage)
		if reason := checkText(message, PrivateMessageMax, in.Checks); reason != "" {
			return handOverPlan(in, KindUnsure, handover{Reason: reason})
		}
		private := assistant.AILabelIn(in.Name, in.AccountKind, in.Language) + "\n" + message
		status := in.aiTextStatus()
		return plan{Kind: KindOrder, Public: pick(orderNotes, in), Private: private, PublicStatus: status, PrivateStatus: status}
	case KindComplaint, KindUnsure:
		return handOverPlan(in, answer.Kind, handover{Reason: answer.Kind, Subject: answer.Subject, Summary: answer.Summary, Category: answer.Category})
	}
	return handOverPlan(in, KindUnsure, handover{Reason: failureReason(answer.Reason)})
}

// handOverPlan is a fixed public note (an apology for a complaint), the
// business's holding reply in private with the AI label, and a request.
func handOverPlan(in planInputs, kind string, h handover) plan {
	notes := unsureNotes
	if kind == KindComplaint {
		notes = complaintNotes
	}
	private := assistant.AILabelIn(in.Name, in.AccountKind, in.Language) + "\n" + in.HoldingReply
	return plan{Kind: kind, Public: pick(notes, in), Private: private, PublicStatus: PartSending, PrivateStatus: PartSending, Handover: &h}
}

// aiTextStatus: the AI's own text goes at once, or waits in "Ask me first".
func (in planInputs) aiTextStatus() string {
	if in.ReplyMode == "ask_first" {
		return PartWaiting
	}
	return PartSending
}

// checkText is "" when the AI's text may go, else why not: empty or too
// long (unusable), or one of ansa's reply checks (a price not on the menu
// or in the owner's own texts, refund words, an unknown link).
func checkText(text string, max int, checks assistant.CheckData) string {
	if text == "" || utf8.RuneCountInString(text) > max {
		return "unusable_answer"
	}
	return assistant.CheckReply(text, checks)
}

// failureReason is why the AI gave no proposal, as a request's reason.
func failureReason(reason string) string {
	switch reason {
	case "model_unavailable", "unusable_answer":
		return reason
	}
	return "model_failed"
}

// oneLine: a public reply is one plain line.
func oneLine(text string) string {
	return strings.TrimSpace(plaintext.SingleLine(text))
}

// status is the comment's status once the plan is saved: skipped, waiting
// for a person, or still being answered while its parts go out.
func (p plan) status() string {
	switch {
	case p.SkipReason != "":
		return StatusSkipped
	case p.PublicStatus == PartWaiting || p.PrivateStatus == PartWaiting:
		return StatusWaiting
	}
	return StatusNew
}
