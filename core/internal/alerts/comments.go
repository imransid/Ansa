package alerts

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"strconv"
	"strings"

	"ansa/core/internal/assistant"
	"ansa/core/internal/comments"
	"ansa/core/internal/email"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/telegram"
)

// HandleCommentJob runs the "comment.alert" job: a comment on the
// business's Facebook post needs a person (a complaint, or ansa unsure).
// The owners are told who, why, what reached the commenter, and where to
// look: their Messenger conversation, else the request. Never the comment.
func (a *Alerter) HandleCommentJob(ctx context.Context, job *jobs.Job) error {
	var payload comments.AlertPayload
	if json.Unmarshal(job.Payload, &payload) != nil || assistant.ReasonText[payload.Reason] == "" {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	over, err := a.Limiter.Over(ctx, "owner-alerts", job.CompanyID.String(), alertLimit)
	if err != nil || over {
		if over {
			a.Log.Warn("alerts: skipped, hourly limit")
		}
		return err
	}
	comment, err := comments.ReadAlertDetails(ctx, a.Pool, job.CompanyID, payload.CommentID)
	if errors.Is(err, comments.ErrNotFound) {
		return &jobs.Failure{Code: "comment_gone", Permanent: true}
	}
	if err != nil {
		return err
	}
	details, err := readCompanyDetails(ctx, a.Pool, job.CompanyID)
	if err != nil {
		return err
	}
	alert := CommentNeedsYou{CommenterName: comment.CommenterName, Reason: payload.Reason, PublicSent: comment.PublicSent, PrivateSent: comment.PrivateSent,
		Link: a.AppURL + "/tickets/" + strconv.Itoa(comment.RequestNumber)}
	if comment.ConversationID != "" {
		alert.Link = a.AppURL + "/inbox/" + comment.ConversationID
	}
	if details.AlertByEmail {
		for _, owner := range details.Owners {
			rendered := alert.Email(owner.Name)
			result := a.Email.Send(ctx, email.Message{From: a.Email.FromHeader(details.CompanyName), To: owner.Email, Subject: rendered.Subject,
				HTML: rendered.HTML, Text: rendered.Text, IdempotencyKey: "comment-needs-you-" + job.ID + "-" + owner.ID})
			if !result.OK {
				a.Log.Warn("alerts: email not sent", logging.Code(result.Error))
			}
		}
	}
	if a.TelegramToken != "" && details.TelegramChatID != "" {
		if result := telegram.Send(ctx, a.TelegramToken, details.TelegramChatID, alert.TelegramNote(), ""); result.Status != "sent" {
			a.Log.Warn("alerts: telegram note not sent", logging.Code(result.Error))
		}
	}
	return nil
}

// CommentNeedsYou is one alert about a comment.
type CommentNeedsYou struct {
	CommenterName           *string
	Reason                  string
	PublicSent, PrivateSent bool
	Link                    string
}

// who is the commenter's name as one plain line (they wrote it themselves).
func (n CommentNeedsYou) who() string {
	return NeedsYou{CustomerName: n.CommenterName}.customer()
}

// whatTheyGot: what reached the commenter before a person does.
func (n CommentNeedsYou) whatTheyGot() string {
	switch {
	case n.PublicSent && n.PrivateSent:
		return "ansa replied under the comment and sent them your holding reply in Messenger."
	case n.PrivateSent:
		return "ansa sent them your holding reply in Messenger."
	case n.PublicSent:
		return "ansa replied under the comment."
	}
	return "No reply reached them."
}

// Email is the alert for one owner.
func (n CommentNeedsYou) Email(ownerName string) Rendered {
	who := n.who()
	why := assistant.ReasonTextFor(n.Reason, "business")
	subject := []rune(who + " needs you about a comment on Facebook")
	if len(subject) > 150 {
		subject = subject[:150]
	}
	line := who + " needs you about a comment on your Facebook post. " + why
	text := strings.Join([]string{"Hi " + ownerName + ",", "", line, "", n.whatTheyGot(), "", "Open it: " + n.Link}, "\n")
	page := `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ` + html.EscapeString(ownerName) + `,</p>
    <p><strong>` + html.EscapeString(who) + `</strong> needs you about a comment on your Facebook post. ` + html.EscapeString(why) + `</p>
    <p>` + html.EscapeString(n.whatTheyGot()) + `</p>
    <p><a href="` + html.EscapeString(n.Link) + `">Open it</a></p>
  </body>
</html>`
	return Rendered{Subject: string(subject), HTML: page, Text: text}
}

// TelegramNote is the same alert as one short message from ansa's bot.
func (n CommentNeedsYou) TelegramNote() string {
	return n.who() + " needs you about a comment on your Facebook post. " + assistant.ReasonTextFor(n.Reason, "business") + " Open: " + n.Link
}
