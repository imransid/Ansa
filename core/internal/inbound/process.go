package inbound

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// At most 100 AI triages an hour per company (From can't be trusted, so one
// sender changing address gets past the per-sender limit: this bounds the
// paid calls). Past it the request is made without the AI.
var triageLimit = ratelimit.Rule{MaxAttempts: 100, Window: time.Hour}

const emailRequestNote = "From a customer email. The original email is on this ticket."

// Processor turns received emails into requests.
type Processor struct {
	Pool    *database.Pool
	Box     *secure.Box
	Limiter *ratelimit.Limiter
	Fetcher *resend.Fetcher
	Brain   *brainclient.Client
	Log     *logging.Logger
	// ansa's own addresses: mail from them is a loop, never a request.
	EmailFrom, ForwardingDomain string
}

// What a run ended in.
const (
	Ticketed   = "ticketed"
	Ignored    = "ignored"
	NotClaimed = "not-claimed"
)

// HandleJob runs "inbound_email.process" (queued by the webhook).
func (p *Processor) HandleJob(ctx context.Context, job *jobs.Job) error {
	var payload resend.ProcessPayload
	if json.Unmarshal(job.Payload, &payload) != nil || payload.InboundEmailID == "" {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	outcome, err := p.Process(ctx, job.CompanyID, payload.InboundEmailID, claimNew, true)
	if err != nil || outcome != NotClaimed {
		return err
	}
	// Core stopped in the middle of this email: the job comes back after its
	// 10-minute lease, but the claim takes the email only 15 minutes after
	// that run started. Try again later (the webhook gives the job 5 tries,
	// whose growing waits reach past those 15 minutes) instead of ending
	// with the email stuck until someone presses "Process again".
	processing, err := stillProcessing(ctx, p.Pool, job.CompanyID, payload.InboundEmailID)
	if err != nil {
		return err
	}
	if processing {
		return &jobs.Failure{Code: "still_processing"}
	}
	return nil
}

// Process claims the email with `claim`, fetches its content and turns it
// into a request (or records why not). applyFilters is false for "Make a
// ticket anyway".
func (p *Processor) Process(ctx context.Context, company tenant.CompanyID, inboundEmailID, claim string, applyFilters bool) (string, error) {
	resendID, err := claimEmail(ctx, p.Pool, company, inboundEmailID, claim)
	if err != nil || resendID == "" {
		return NotClaimed, err
	}
	content, code := p.Fetcher.Fetch(ctx, resendID)
	if content == nil {
		p.Log.Warn("resend receiving fetch failed", logging.Code(code))
		return Ignored, markIgnored(ctx, p.Pool, company, inboundEmailID, "content_unavailable", "")
	}
	support, err := supportAddresses(ctx, p.Pool, company)
	if err != nil {
		return "", p.giveUp(ctx, company, inboundEmailID, err)
	}
	sender := ReadSender(content, support, p.EmailFrom, p.ForwardingDomain)
	email := Prepare(content)
	// A loop: never a request, not even "anyway" or as the fallback.
	if sender.Own == "ansa" {
		return Ignored, markIgnored(ctx, p.Pool, company, inboundEmailID, "own_address", sender.Shown)
	}
	if applyFilters {
		reason, err := reasonToIgnore(ctx, p.Limiter, company, sender, content.Headers, support)
		if err != nil {
			return p.saveFallback(ctx, company, inboundEmailID, email, sender)
		}
		if reason != "" {
			return Ignored, markIgnored(ctx, p.Pool, company, inboundEmailID, reason, sender.Shown)
		}
	}
	request, err := p.triage(ctx, company, email, sender)
	if err != nil {
		return p.saveFallback(ctx, company, inboundEmailID, email, sender)
	}
	saved, err := saveRequest(ctx, p.Pool, p.Box, company, inboundEmailID, email, sender, request)
	if err != nil {
		p.Log.Error("inbound email triage failed, saving it without the AI", logging.ErrorType(err))
		return p.saveFallback(ctx, company, inboundEmailID, email, sender)
	}
	return map[bool]string{true: Ticketed, false: NotClaimed}[saved], nil
}

// saveFallback saves the request without the AI's work (the email's own
// subject, no category; the sender only when they pass the request's rules).
func (p *Processor) saveFallback(ctx context.Context, company tenant.CompanyID, inboundEmailID string, email Prepared, sender Sender) (string, error) {
	request := withoutAI(email.Subject, "processing the email failed, so it was saved without the AI")
	saved, err := saveRequest(ctx, p.Pool, p.Box, company, inboundEmailID, email, sender, request)
	if err != nil {
		return "", p.giveUp(ctx, company, inboundEmailID, err)
	}
	return map[bool]string{true: Ticketed, false: NotClaimed}[saved], nil
}

// giveUp: only a database failure gets here; the email is marked, or stays
// "processing" and is claimed again 15 minutes later.
func (p *Processor) giveUp(ctx context.Context, company tenant.CompanyID, inboundEmailID string, err error) error {
	p.Log.Error("inbound email processing failed", logging.ErrorType(err))
	_ = markIgnored(ctx, p.Pool, company, inboundEmailID, "processing_error", "")
	return nil
}

// request is the new request's fields from the triage.
type request struct {
	Subject, Summary, Category, MissingAI string
}

type brainTriage struct {
	Kind     string `json:"kind"`
	Reason   string `json:"reason"`
	Summary  string `json:"summary"`
	Subject  string `json:"subject"`
	Category string `json:"category"`
}

// triage asks the brain for the summary, subject and category (within the
// company's hourly cap), or makes the request without it.
func (p *Processor) triage(ctx context.Context, company tenant.CompanyID, email Prepared, sender Sender) (request, error) {
	over, err := p.Limiter.Over(ctx, "email-triage", company.String(), triageLimit)
	if err != nil {
		return request{}, err
	}
	if over {
		return withoutAI(email.Subject, "more than "+strconv.Itoa(triageLimit.MaxAttempts)+" emails reached your company this hour, so the AI skipped this one"), nil
	}
	categories, err := activeCategories(ctx, p.Pool, company)
	if err != nil {
		return request{}, err
	}
	var answer brainTriage
	body := map[string]any{"subject": email.Subject, "body": email.Body, "categories": categories}
	if err := p.Brain.Call(ctx, "/v1/email/triage", body, &answer); err != nil || answer.Kind != "ok" {
		why := "the AI could not answer"
		if answer.Reason == "model_unavailable" {
			why = "no AI key is set"
		}
		return withoutAI(email.Subject, why), nil
	}
	subject := cutRunes(plaintext.SingleLine(answer.Subject), 200)
	if subject == "" {
		subject = fallbackSubject(email.Subject)
	}
	category := ""
	for _, name := range categories {
		if name == answer.Category {
			category = name
		}
	}
	return request{Subject: subject, Summary: strings.TrimSpace(answer.Summary), Category: category}, nil
}

func withoutAI(subject, why string) request {
	return request{Subject: fallbackSubject(subject), MissingAI: why}
}

var cardLike = regexp.MustCompile(`\b\d(?:[ -]?\d){12,18}\b`)

// fallbackSubject is the email's own subject: one plain line, card-like
// numbers hidden BEFORE the cut, at most 200.
func fallbackSubject(subject string) string {
	cleaned := cutRunes(cardLike.ReplaceAllString(plaintext.SingleLine(subject), "[number]"), 200)
	if cleaned == "" {
		return "Customer email"
	}
	return cleaned
}
