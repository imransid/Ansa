package jobs

import (
	"context"
	"errors"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
)

// Handler runs one job. Return nil when done, a *Failure to say why it
// failed (Permanent: don't try again), any other error to try again.
type Handler func(ctx context.Context, job *Job) error

// Worker claims due jobs one at a time and runs their handlers.
type Worker struct {
	pool     *database.Pool
	log      *logging.Logger
	handlers map[string]Handler
	// How long one job may run before it counts as cut off (handed back).
	Lease time.Duration
	// How long to wait when nothing is due.
	Idle time.Duration
}

// NewWorker makes a worker with a 10-minute lease and a 1-second idle wait.
func NewWorker(pool *database.Pool, log *logging.Logger) *Worker {
	return &Worker{pool: pool, log: log, handlers: map[string]Handler{}, Lease: 10 * time.Minute, Idle: time.Second}
}

// Handle registers the handler for one kind of job.
func (w *Worker) Handle(kind string, handler Handler) {
	w.handlers[kind] = handler
}

// Run works until ctx is canceled. Several Runs may share one Worker: each
// claim takes a different job (SKIP LOCKED).
func (w *Worker) Run(ctx context.Context) {
	for ctx.Err() == nil {
		worked, err := w.RunOnce(ctx)
		if err != nil {
			w.log.Error("jobs: claim failed", logging.ErrorType(err))
		}
		if !worked {
			sleep(ctx, w.Idle)
		}
	}
}

// RunOnce hands back stuck jobs, then claims and runs one due job. It
// reports whether a job ran.
func (w *Worker) RunOnce(ctx context.Context) (bool, error) {
	if _, err := handBackStuck(ctx, w.pool, w.Lease); err != nil {
		return false, err
	}
	job, err := claimNext(ctx, w.pool)
	if err != nil || job == nil {
		return false, err
	}
	handler, known := w.handlers[job.Kind]
	if !known {
		return true, markFailed(ctx, w.pool, job, "unknown_kind", true)
	}
	// Stopping the service stops the claiming, never a job halfway (a send
	// cut off can't tell whether the customer got it): the job keeps its own
	// time, its lease.
	keepGoing := context.WithoutCancel(ctx)
	jobCtx, cancel := context.WithTimeout(keepGoing, w.Lease)
	defer cancel()
	started := time.Now()
	if runErr := runSafely(jobCtx, handler, job); runErr != nil {
		var failure *Failure
		permanent := errors.As(runErr, &failure) && failure.Permanent
		w.log.Warn("jobs: try failed", logging.Code(safeCode(runErr)), logging.Count("attempt", job.Attempt), logging.Took(time.Since(started)))
		return true, markFailed(keepGoing, w.pool, job, safeCode(runErr), permanent)
	}
	return true, markDone(keepGoing, w.pool, job)
}

// runSafely turns a handler's panic into a failed try instead of a dead worker.
func runSafely(ctx context.Context, handler Handler, job *Job) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = &Failure{Code: "handler_panic"}
		}
	}()
	return handler(ctx, job)
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
