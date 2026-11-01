// Package jobs is core's job queue, stored in PostgreSQL (the core_jobs
// table): work that must survive a restart, like answering a customer or
// sending a post. Several workers share it safely: each claim takes one due
// job with FOR UPDATE SKIP LOCKED. A failed job is tried again after a
// growing wait, up to its maximum tries; a job whose worker died is handed
// back after its lease. Payloads hold ids only, never a customer's words.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Job is one claimed job, handed to its handler.
type Job struct {
	ID        string
	CompanyID tenant.CompanyID
	Kind      string
	Payload   json.RawMessage
	Attempt   int
}

// NewJob is what Enqueue saves.
type NewJob struct {
	Kind    string
	Payload any
	// RunAfter: when it may start (zero: now).
	RunAfter time.Time
	// MaxAttempts: how many tries (zero: 5).
	MaxAttempts int
	// DedupeKey: the same key waiting or running for this company is one job.
	DedupeKey string
}

// Failure is what a handler returns to say why a try failed, as a code
// ("brain_unavailable"), never a message. Permanent: don't try again.
type Failure struct {
	Code      string
	Permanent bool
}

func (f *Failure) Error() string { return "job failed: " + f.Code }

// ErrDuplicate means a job with this DedupeKey is already waiting or running.
var ErrDuplicate = errors.New("jobs: the same job is already waiting")

var kindPattern = regexp.MustCompile(`^[a-z][a-z0-9_.]{1,60}$`)
var codePattern = regexp.MustCompile(`^[a-z0-9_]{1,60}$`)

// Enqueue saves a job for one company.
func Enqueue(ctx context.Context, pool *database.Pool, company tenant.CompanyID, job NewJob) (string, error) {
	if company.IsZero() || !kindPattern.MatchString(job.Kind) {
		return "", errors.New("jobs: a job needs a company and a kind like assistant.reply")
	}
	payload, err := json.Marshal(job.Payload)
	if err != nil {
		return "", errors.New("jobs: the payload can't be written as JSON")
	}
	if job.MaxAttempts == 0 {
		job.MaxAttempts = 5
	}
	return insertJob(ctx, pool, company, job, payload)
}

// EnqueueWithin saves a job inside the caller's transaction: it exists only
// if the work that needs it was saved too.
func EnqueueWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, job NewJob) (string, error) {
	if company.IsZero() || !kindPattern.MatchString(job.Kind) {
		return "", errors.New("jobs: a job needs a company and a kind like assistant.reply")
	}
	payload, err := json.Marshal(job.Payload)
	if err != nil {
		return "", errors.New("jobs: the payload can't be written as JSON")
	}
	if job.MaxAttempts == 0 {
		job.MaxAttempts = 5
	}
	return insertJobWithin(ctx, tx, company, job, payload)
}

// Backoff is the wait before try n+1: 30 s, 2 min, 8 min, 32 min, then 2 h.
func Backoff(attempt int) time.Duration {
	wait := 30 * time.Second
	for i := 1; i < attempt && wait < 2*time.Hour; i++ {
		wait *= 4
	}
	if wait > 2*time.Hour {
		wait = 2 * time.Hour
	}
	return wait
}

// safeCode keeps an error code to the allowed shape.
func safeCode(err error) string {
	var failure *Failure
	if errors.As(err, &failure) && codePattern.MatchString(failure.Code) {
		return failure.Code
	}
	return "handler_error"
}
