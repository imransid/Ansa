package resend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// Resend's events are small (metadata only; content is fetched separately).
const maxBodyBytes = 256 << 10

// ProcessJobKind turns one received email into a request (core/internal/inbound).
const ProcessJobKind = "inbound_email.process"

// ProcessPayload names the received email's row.
type ProcessPayload struct {
	InboundEmailID string `json:"inboundEmailId"`
}

// Every company's mail comes from Resend's addresses: a ceiling, after the signature.
var webhookLimit = ratelimit.Rule{MaxAttempts: 600, Window: time.Minute}

// Delivery problems of emails ansa sent: never delivered, although Resend took them.
var deliveryProblems = map[string]string{"email.bounced": "bounced", "email.complained": "complained", "email.suppressed": "suppressed", "email.failed": "failed"}

// Webhook is Resend's webhook (POST /webhooks/resend).
type Webhook struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
	// RESEND_WEBHOOK_SECRET ("whsec_..."); empty: every request is refused.
	Secret string
	// INBOUND_EMAIL_DOMAIN: forwarding addresses are c-<token>@ this.
	ForwardingDomain string
}

type event struct {
	Type string `json:"type"`
	Data *struct {
		EmailID     string          `json:"email_id"`
		To          json.RawMessage `json:"to"`
		Cc          json.RawMessage `json:"cc"`
		Bcc         json.RawMessage `json:"bcc"`
		ReceivedFor json.RawMessage `json:"received_for"`
	} `json:"data"`
}

// ServeHTTP checks, in this order: size, Resend's signature over the raw
// bytes, the rate limit; then parses. Received emails are saved once and
// processed by a job after the answer.
func (h *Webhook) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := httpserver.ReadBody(r, maxBodyBytes)
	if err == httpserver.ErrTooLarge {
		h.Log.Warn("resend webhook rejected", logging.Code("too_large"))
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil || h.Secret == "" || !IsSigned(r.Header, body, h.Secret, time.Now()) {
		h.Log.Warn("resend webhook rejected", logging.Code("bad_signature"))
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if over, err := h.Limiter.Over(r.Context(), "resend-webhook", httpserver.ClientIP(r), webhookLimit); err != nil || over {
		h.Log.Warn("resend webhook rejected", logging.Code("rate_limited"))
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	var e event
	if json.NewDecoder(bytes.NewReader(body)).Decode(&e) != nil || len(e.Type) > 100 {
		h.Log.Warn("resend webhook rejected", logging.Code("not_an_event"))
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err := h.handle(r.Context(), e); err != nil {
		h.Log.Error("resend webhook failed", logging.ErrorType(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *Webhook) handle(ctx context.Context, e event) error {
	if e.Data == nil || e.Data.EmailID == "" || len(e.Data.EmailID) > 200 {
		return nil
	}
	if problem, known := deliveryProblems[e.Type]; known {
		return markDeliveryProblem(ctx, h.Pool, e.Data.EmailID, problem)
	}
	if e.Type != "email.received" {
		return nil
	}
	var recipients []string
	for _, list := range []json.RawMessage{e.Data.To, e.Data.Cc, e.Data.Bcc, e.Data.ReceivedFor} {
		recipients = append(recipients, recipientList(list)...)
	}
	companies, err := companiesOfTokens(ctx, h.Pool, forwardingTokens(recipients, h.ForwardingDomain))
	if err != nil {
		return err
	}
	switch len(companies) {
	case 0:
		h.Log.Warn("inbound email ignored", logging.Code("no_forwarding_address"))
		return nil
	case 1:
	default:
		// Never handed to the first one listed.
		h.Log.Warn("inbound email ignored", logging.Code("several_companies"))
		return nil
	}
	return SaveAndQueue(ctx, h.Pool, companies[0], e.Data.EmailID)
}

// recipientList is one list as Resend gives it, never refused (a signed
// event refused would be retried for days): a single address becomes a
// list, odd entries drop, at most 50 kept.
func recipientList(raw json.RawMessage) []string {
	var list []any
	if json.Unmarshal(raw, &list) != nil {
		var one string
		if json.Unmarshal(raw, &one) != nil {
			return nil
		}
		list = []any{one}
	}
	var kept []string
	for _, entry := range list {
		if text, ok := entry.(string); ok && len(text) <= 320 && len(kept) < 50 {
			kept = append(kept, text)
		}
	}
	return kept
}

var forwardingLocalPart = regexp.MustCompile(`^c-([0-9a-f]{32})$`)
var lastAngleGroup = regexp.MustCompile(`<([^<>]*)>\s*$`)

// forwardingTokens are the distinct tokens of every forwarding address in
// the recipient lists (only ansa makes such an address, so reading headers
// a sender writes is safe).
func forwardingTokens(recipients []string, domain string) []string {
	seen := map[string]bool{}
	var tokens []string
	for _, recipient := range recipients {
		address := strings.ToLower(strings.TrimSpace(recipient))
		if match := lastAngleGroup.FindStringSubmatch(address); match != nil {
			address = strings.TrimSpace(match[1])
		}
		local, host, found := strings.Cut(address, "@")
		token := forwardingLocalPart.FindStringSubmatch(local)
		if found && host == domain && token != nil && !seen[token[1]] {
			seen[token[1]] = true
			tokens = append(tokens, token[1])
		}
	}
	return tokens
}

func companiesOfTokens(ctx context.Context, pool *database.Pool, tokens []string) ([]tenant.CompanyID, error) {
	if len(tokens) == 0 {
		return nil, nil
	}
	const statement = `
		-- cross-company: a forwarding address's token (only ansa makes them) names the company; ids only.
		SELECT id FROM companies WHERE inbound_token = ANY($1) LIMIT 2`
	rows, err := pool.Query(ctx, statement, tokens)
	if err != nil {
		return nil, err
	}
	var found []tenant.CompanyID
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		company, err := tenant.FromTrustedSource(id)
		if err != nil {
			return nil, err
		}
		found = append(found, company)
	}
	return found, rows.Err()
}

// SaveAndQueue saves the received email once (Resend's id is unique) and
// queues its processing in the same transaction: the webhook's last step,
// and the practice email's in development (core/internal/practicechat).
func SaveAndQueue(ctx context.Context, pool *database.Pool, company tenant.CompanyID, resendEmailID string) error {
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		var id string
		err := tx.QueryRow(ctx, `INSERT INTO inbound_emails (company_id, resend_email_id) VALUES ($1, $2) ON CONFLICT (resend_email_id) DO NOTHING RETURNING id`,
			company.String(), resendEmailID).Scan(&id)
		if err != nil {
			return ignoreNoRows(err)
		}
		_, err = jobs.EnqueueWithin(ctx, tx, company, jobs.NewJob{Kind: ProcessJobKind, Payload: ProcessPayload{InboundEmailID: id}, MaxAttempts: 5})
		return err
	})
}

// markDeliveryProblem records a bounce, a spam report, a suppression or a
// failure on the sent email with Resend's id (the first one reported wins).
func markDeliveryProblem(ctx context.Context, pool *database.Pool, providerMessageID, problem string) error {
	const statement = `
		-- cross-company: Resend's id names one sent email of one company; only that row changes.
		UPDATE outgoing_emails SET delivery_problem = $2, delivery_problem_at = now()
		WHERE provider_message_id = $1 AND status = 'sent' AND delivery_problem IS NULL`
	_, err := pool.Exec(ctx, statement, providerMessageID, problem)
	return err
}

func ignoreNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}
