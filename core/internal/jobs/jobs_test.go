package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/tenant"
)

func setup(t *testing.T) (*database.Pool, tenant.CompanyID, *Worker) {
	pool := database.ForTest(t)
	company, err := tenant.FromTrustedSource(database.TestCompany(t, pool))
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	worker := NewWorker(pool, logging.New(&logs))
	worker.OnlyCompany = company.String()
	return pool, company, worker
}

func statusOf(t *testing.T, pool *database.Pool, company tenant.CompanyID, id string) (status string, attempts int, code *string) {
	t.Helper()
	err := pool.QueryRow(context.Background(), `SELECT status, attempts, last_error_code FROM core_jobs WHERE company_id = $1 AND id = $2`, company.String(), id).Scan(&status, &attempts, &code)
	if err != nil {
		t.Fatalf("reading the job: %v", err)
	}
	return status, attempts, code
}

func TestAJobRunsOnceAndIsDone(t *testing.T) {
	pool, company, worker := setup(t)
	ran := 0
	worker.Handle("test.done", func(_ context.Context, job *Job) error {
		var payload struct{ MessageID string }
		json.Unmarshal(job.Payload, &payload)
		if job.CompanyID != company || payload.MessageID != "m1" {
			t.Errorf("wrong job: %+v", job)
		}
		ran++
		return nil
	})
	id, err := Enqueue(context.Background(), pool, company, NewJob{Kind: "test.done", Payload: map[string]string{"MessageID": "m1"}})
	if err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	runUntilDone(t, worker, pool, company, id)
	if status, _, _ := statusOf(t, pool, company, id); status != "done" || ran != 1 {
		t.Fatalf("status %s, ran %d", status, ran)
	}
}

func TestAFailedTryWaitsAndAPermanentFailureStops(t *testing.T) {
	pool, company, worker := setup(t)
	worker.Handle("test.retry", func(context.Context, *Job) error { return &Failure{Code: "brain_unavailable"} })
	worker.Handle("test.stop", func(context.Context, *Job) error { return &Failure{Code: "not_allowed", Permanent: true} })
	retry, _ := Enqueue(context.Background(), pool, company, NewJob{Kind: "test.retry"})
	stop, _ := Enqueue(context.Background(), pool, company, NewJob{Kind: "test.stop"})
	runUntilNotQueued(t, worker, pool, company, retry)
	runUntilNotQueued(t, worker, pool, company, stop)
	if status, attempts, code := statusOf(t, pool, company, retry); status != "queued" || attempts != 1 || *code != "brain_unavailable" {
		t.Fatalf("retry: %s %d %v", status, attempts, code)
	}
	if status, _, code := statusOf(t, pool, company, stop); status != "failed" || *code != "not_allowed" {
		t.Fatalf("stop: %s %v", status, code)
	}
}

func TestTheSameDedupeKeyWaitsOnce(t *testing.T) {
	pool, company, _ := setup(t)
	job := NewJob{Kind: "test.once", DedupeKey: "conversation-1", RunAfter: time.Now().Add(time.Hour)}
	if _, err := Enqueue(context.Background(), pool, company, job); err != nil {
		t.Fatal(err)
	}
	if _, err := Enqueue(context.Background(), pool, company, job); err != ErrDuplicate {
		t.Fatalf("expected ErrDuplicate, got %v", err)
	}
}

func TestBackoffGrowsAndStopsAtTwoHours(t *testing.T) {
	if Backoff(1) != 30*time.Second || Backoff(2) != 2*time.Minute || Backoff(10) != 2*time.Hour {
		t.Fatalf("got %v %v %v", Backoff(1), Backoff(2), Backoff(10))
	}
}

// The local database may hold other due jobs; run until ours left "queued".
func runUntilNotQueued(t *testing.T, worker *Worker, pool *database.Pool, company tenant.CompanyID, id string) {
	t.Helper()
	for i := 0; i < 50; i++ {
		var claimedAt *time.Time
		pool.QueryRow(context.Background(), `SELECT claimed_at FROM core_jobs WHERE company_id = $1 AND id = $2`, company.String(), id).Scan(&claimedAt)
		if claimedAt != nil {
			return
		}
		if _, err := worker.RunOnce(context.Background()); err != nil {
			t.Fatalf("RunOnce: %v", err)
		}
	}
	t.Fatal("our job never ran")
}

func runUntilDone(t *testing.T, worker *Worker, pool *database.Pool, company tenant.CompanyID, id string) {
	runUntilNotQueued(t, worker, pool, company, id)
}
