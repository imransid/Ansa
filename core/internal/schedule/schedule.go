// Package schedule runs core's periodic work (the old cron routes, which on
// Vercel's free plan ran once a day): each task every few seconds, inside the
// service. Several core processes may run the same tasks at once: every task
// claims its work in the database (SKIP LOCKED), so none is done twice.
package schedule

import (
	"context"
	"time"

	"ansa/core/internal/logging"
)

// Task is one piece of periodic work.
type Task struct {
	// A fixed name for the log ("assistant catch-up").
	Name  string
	Every time.Duration
	// Run does one round; it returns how many things it did.
	Run func(ctx context.Context) (int, error)
}

// Run runs every task on its own beat until ctx is canceled.
func Run(ctx context.Context, log *logging.Logger, tasks []Task) {
	for _, task := range tasks {
		go loop(ctx, log, task)
	}
	<-ctx.Done()
}

func loop(ctx context.Context, log *logging.Logger, task Task) {
	ticker := time.NewTicker(task.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			done, err := task.Run(ctx)
			if err != nil && ctx.Err() == nil {
				log.Error("schedule: "+task.Name+" failed", logging.ErrorType(err))
			} else if done > 0 {
				log.Info("schedule: "+task.Name, logging.Count("done", done))
			}
		}
	}
}
