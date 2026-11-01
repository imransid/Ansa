package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// Latest is a request's newest customer email, as its page shows it.
type Latest struct {
	ID        string     `json:"id"`
	ToEmail   string     `json:"toEmail"`
	Status    string     `json:"status"`
	LastError *string    `json:"lastError"`
	SentAt    *time.Time `json:"sentAt"`
	// What Resend reported after sending: bounced, complained, suppressed or
	// failed (nil: nothing), and its id ("dev-outbox:..." = a file in development).
	DeliveryProblem   *string `json:"deliveryProblem"`
	ProviderMessageID *string `json:"providerMessageId"`
	// A delivery is on its way: no Retry is offered.
	InProgress bool `json:"inProgress"`
	// Its first try was 23+ hours ago: a Retry asks "send it again anyway?".
	NeedsConfirmation bool `json:"needsConfirmation"`
}

// ReadLatest reads a request's newest customer email (nil: none).
func ReadLatest(ctx context.Context, pool *database.Pool, company tenant.CompanyID, ticketID string) (*Latest, error) {
	const statement = `
		SELECT id, to_email, status, last_error, sent_at, delivery_problem::text, provider_message_id,
			(status = 'sending' AND last_attempt_at >= now() - interval '10 minutes')
				OR (status = 'pending' AND created_at >= now() - interval '10 minutes' AND COALESCE(last_error, '') <> 'daily_limit'),
			NOT (first_attempt_at IS NULL OR first_attempt_at > now() - interval '23 hours')
		FROM outgoing_emails WHERE company_id = $1 AND ticket_id = $2
		ORDER BY created_at DESC LIMIT 1`
	var l Latest
	err := pool.QueryRow(ctx, statement, company.String(), ticketID).Scan(&l.ID, &l.ToEmail, &l.Status, &l.LastError, &l.SentAt, &l.DeliveryProblem, &l.ProviderMessageID, &l.InProgress, &l.NeedsConfirmation)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &l, err
}

// HandleJob runs "customer_email.deliver": a failed send is tried again
// soon (within minutes: safe, the idempotency key holds 24 hours); the
// daily limit or a delivery no longer possible ends it.
func (d *Deliverer) HandleJob(ctx context.Context, job *jobs.Job) error {
	var payload tickets.DeliverPayload
	if json.Unmarshal(job.Payload, &payload) != nil || payload.EmailID == "" {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	outcome, err := d.Deliver(ctx, job.CompanyID, payload.EmailID, false)
	if err != nil {
		return err
	}
	if outcome == Failed {
		return &jobs.Failure{Code: "send_failed"}
	}
	return nil
}
