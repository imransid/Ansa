// Package comments answers comments on a business's Facebook Page posts.
// A new comment arrives through the Page's signed webhook
// (core/internal/messenger hands it here, for the one company that has the
// Page connected), is saved once (encrypted) and answered by a job: the
// brain reads the business's own details, the post and the comment, and
// proposes; core decides what goes out and checks it as it checks chat
// replies. A real question gets a short public reply; a price question or
// an order a short public note and a private message (Meta's private reply,
// which opens the commenter's Messenger chat, where the assistant carries
// on); a complaint, or anything ansa is unsure of, a public note, the
// business's holding reply in private and a request for a person; praise
// and spam nothing. Only core/internal/messenger talks to Meta.
package comments

import (
	"time"

	"ansa/core/internal/tenant"
)

// AnswerJobKind decides and sends ansa's answer to one comment.
const AnswerJobKind = "comment.answer"

// AlertJobKind tells the owners a comment needs them (core/internal/alerts).
const AlertJobKind = "comment.alert"

// A comment's status.
const (
	// Received and being answered (also while a reply goes out).
	StatusNew = "new"
	// ansa's answer went out (or may have: "unclear").
	StatusAnswered = "answered"
	// "Ask me first": the AI's own text waits for someone's Send or Discard.
	StatusWaiting = "waiting"
	// Nothing goes out: SkipReason says why.
	StatusSkipped = "skipped"
	// Every part ansa tried to send failed.
	StatusFailed = "failed"
)

// Why nothing goes out.
const (
	SkipThanks        = "thanks"
	SkipSpam          = "spam"
	SkipOwnComment    = "own_comment"
	SkipReplyInThread = "reply_in_thread"
	SkipCommentsOff   = "comments_off"
	SkipPackage       = "package"
	SkipLimit         = "limit"
	SkipTooOld        = "too_old"
	SkipNotAllowed    = "not_allowed"
	// Someone pressed Discard on ansa's waiting reply.
	SkipDiscarded = "discarded"
)

// What the AI read a comment as.
const (
	KindQuestion  = "question"
	KindOrder     = "order"
	KindComplaint = "complaint"
	KindThanks    = "thanks"
	KindSpam      = "spam"
	KindUnsure    = "unsure"
)

// A part's (the public reply's, the private message's) status.
const (
	PartSending   = "sending"
	PartSent      = "sent"
	PartFailed    = "failed"
	PartUnclear   = "unclear"
	PartWaiting   = "waiting"
	PartDiscarded = "discarded"
)

// Meta allows ONE private reply to a comment, within 7 days of it: an older
// comment is never answered.
const privateReplyWindow = 7 * 24 * time.Hour

// The longest texts ansa sends: a public reply (one or two sentences) and
// the AI's private message (its own label comes on top).
const (
	PublicReplyMax    = 300
	PrivateMessageMax = 1_500
)

// TextContext is the encryption context of one field of one comment
// ("text", "public_reply" or "private_message"): a value copied to another
// company's row, another comment or another field can't be read.
func TextContext(company tenant.CompanyID, commentRowID, field string) string {
	return "page-comment:" + company.String() + ":" + commentRowID + ":" + field
}

// payload is a comment job's: the comment's row id, never its words.
type payload struct {
	CommentID string `json:"commentId"`
}

// AlertPayload is the owners' alert about one comment.
type AlertPayload struct {
	CommentID string `json:"commentId"`
	// Why a person is needed (assistant.ReasonText's keys).
	Reason string `json:"reason"`
}
