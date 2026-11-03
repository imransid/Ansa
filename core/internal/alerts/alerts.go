// Package alerts tells a business's owners that a conversation needs them
// (the old services/owner-alerts.ts): an email to each confirmed, active
// owner while "alert by email" is on, and a note from ansa's bot in the
// business's own Telegram when it is connected. Who, where and why, with a
// link: never the customer's messages. Best effort: a send that fails is
// logged as a code and never undoes the handover.
package alerts

import (
	"context"
	"encoding/json"
	"time"

	"ansa/core/internal/assistant"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/telegram"
)

// At most 60 alerts an hour per business (the old RATE_LIMITS.ownerAlertsPerCompany).
var alertLimit = ratelimit.Rule{MaxAttempts: 60, Window: time.Hour}

// Alerter sends the alerts.
type Alerter struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Email   *email.Sender
	// ansa's bot ("" = no real bot: no Telegram note).
	TelegramToken string
	// The screens' address, for the link.
	AppURL string
	Log    *logging.Logger
}

// HandleJob runs the "owner.alert" job.
func (a *Alerter) HandleJob(ctx context.Context, job *jobs.Job) error {
	var payload assistant.AlertPayload
	if json.Unmarshal(job.Payload, &payload) != nil || assistant.ReasonText[payload.Reason] == "" {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	over, err := a.Limiter.Over(ctx, "owner-alerts", job.CompanyID.String(), alertLimit)
	if err != nil {
		return err
	}
	if over {
		a.Log.Warn("alerts: skipped, hourly limit")
		return nil
	}
	details, err := readDetails(ctx, a.Pool, job.CompanyID, payload)
	if err != nil {
		return err
	}
	alert := NeedsYou{
		CustomerName:     details.CustomerName,
		ChannelLabel:     assistant.ChannelLabels[details.Channel],
		Reason:           payload.Reason,
		HoldingReplySent: details.HoldingReplySent,
		OnACall:          details.Channel == "phone",
		WroteAgain:       payload.WroteAgain,
		Link:             a.AppURL + "/inbox/" + payload.ConversationID,
	}
	if details.AlertByEmail {
		a.emailOwners(ctx, details, alert, job.ID)
	}
	if a.TelegramToken != "" && details.TelegramChatID != "" {
		result := telegram.Send(ctx, a.TelegramToken, details.TelegramChatID, alert.TelegramNote(), "")
		if result.Status != "sent" {
			a.Log.Warn("alerts: telegram note not sent", logging.Code(result.Error))
		}
	}
	return nil
}

// emailOwners sends each owner their email; the job's id makes the key, so
// a retried job never emails anyone twice.
func (a *Alerter) emailOwners(ctx context.Context, details alertDetails, alert NeedsYou, jobID string) {
	for _, owner := range details.Owners {
		rendered := alert.Email(owner.Name)
		result := a.Email.Send(ctx, email.Message{
			From:           a.Email.FromHeader(details.CompanyName),
			To:             owner.Email,
			Subject:        rendered.Subject,
			HTML:           rendered.HTML,
			Text:           rendered.Text,
			IdempotencyKey: "needs-you-" + jobID + "-" + owner.ID,
		})
		if !result.OK {
			a.Log.Warn("alerts: email not sent", logging.Code(result.Error))
		}
	}
}
