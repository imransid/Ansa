package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"ansa/core/internal/alerts"
	"ansa/core/internal/assignments"
	"ansa/core/internal/assistant"
	"ansa/core/internal/autopost"
	"ansa/core/internal/calls"
	"ansa/core/internal/chat"
	"ansa/core/internal/config"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/files"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/maintenance"
	"ansa/core/internal/messenger"
	"ansa/core/internal/postmetrics"
	"ansa/core/internal/publishing"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/schedule"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// The pieces main puts together: the job worker, the one door for chat
// messages, file storage, the periodic tasks, the health check, and a
// graceful stop.

// newWorker registers every job core runs.
func newWorker(cfg config.Config, pool *database.Pool, box *secure.Box, limiter *ratelimit.Limiter, runner *assistant.Runner, mail *email.Sender, log *logging.Logger) *jobs.Worker {
	alerter := &alerts.Alerter{Pool: pool, Limiter: limiter, Email: mail, TelegramToken: cfg.TelegramBotToken, AppURL: cfg.AppURL, Log: log}
	notifier := &assignments.Notifier{Pool: pool, Email: mail, AppURL: cfg.AppURL, Log: log}
	worker := jobs.NewWorker(pool, log)
	worker.Handle(assistant.ReplyJobKind, runner.HandleJob)
	worker.Handle(assistant.AlertJobKind, alerter.HandleJob)
	worker.Handle(assistant.OrderAlertJobKind, alerter.HandleOrderJob)
	worker.Handle(tickets.AssignedJobKind, notifier.HandleJob)
	worker.Handle(messenger.NameJobKind, (&messenger.Names{Pool: pool, Box: box, AppSecret: cfg.FacebookAppSecret}).HandleJob)
	return worker
}

// fileStore is the private file storage: R2 when switched on, else the
// development folder.
func fileStore(cfg config.Config) *files.Store {
	store := &files.Store{DevFolder: cfg.DevFolder}
	if cfg.UseR2 {
		store.R2 = &files.R2{AccountID: cfg.R2AccountID, AccessKeyID: cfg.R2AccessKeyID, SecretAccessKey: cfg.R2SecretAccessKey, Bucket: cfg.R2Bucket}
	}
	return store
}

// vapiSigning is how Vapi signs its webhooks (the VAPI_* settings).
func vapiSigning(cfg config.Config) calls.Signing {
	return calls.Signing{Secret: cfg.VapiWebhookSecret, SignatureHeader: cfg.VapiSignatureHeader, TimestampHeader: cfg.VapiTimestampHeader,
		Algorithm: cfg.VapiSignatureAlgorithm, Payload: cfg.VapiSignaturePayload, Encoding: cfg.VapiSignatureEncoding,
		Prefix: cfg.VapiSignaturePrefix, TimestampUnit: cfg.VapiTimestampUnit, ToleranceSeconds: cfg.VapiToleranceSeconds}
}

// chatSender is the one door for messages to customers.
func chatSender(cfg config.Config, pool *database.Pool, box *secure.Box) *chat.Sender {
	return &chat.Sender{
		TelegramToken:      cfg.TelegramBotToken,
		MessengerAppSecret: cfg.FacebookAppSecret,
		PageToken: func(ctx context.Context, company tenant.CompanyID, connectionID string) (string, error) {
			return social.PageToken(ctx, pool, box, company, connectionID)
		},
		StandInsAllowed: !cfg.IsProduction(),
		StandInDir:      filepath.Join(cfg.DevFolder, ".dev-messages"),
	}
}

// scheduledTasks is core's periodic work, each claimed in the database so
// several core processes never do it twice.
func scheduledTasks(pool *database.Pool, log *logging.Logger, publisher *publishing.Runner, postWriter *autopost.Writer, numbers *postmetrics.Collector) []schedule.Task {
	return []schedule.Task{
		{Name: "assistant catch-up", Every: 15 * time.Second, Run: func(ctx context.Context) (int, error) {
			return assistant.QueueDueReplies(ctx, pool)
		}},
		{Name: "publishing queue", Every: 15 * time.Second, Run: func(ctx context.Context) (int, error) {
			return publisher.RunDue(ctx, "")
		}},
		{Name: "post for me", Every: time.Minute, Run: func(ctx context.Context) (int, error) {
			return postWriter.RunDue(ctx, "", time.Now())
		}},
		{Name: "post numbers", Every: 5 * time.Minute, Run: func(ctx context.Context) (int, error) {
			return numbers.RunDue(ctx, "")
		}},
		{Name: "cleanup", Every: time.Hour, Run: func(ctx context.Context) (int, error) {
			return maintenance.Cleanup(ctx, pool, log, "")
		}},
	}
}

// healthCheck answers 200 when the database answers, 503 when it doesn't:
// the uptime monitor's check. Never a body.
func healthCheck(pool *database.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := database.Ping(r.Context(), pool); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		httpserver.Health(w, r)
	}
}

// waitForStop finishes requests in progress and lets running jobs end (up
// to 20 seconds in all) when the process is asked to stop, so a deploy never
// cuts a webhook or a send in half. A job still running then is handed back
// after its lease.
func waitForStop(server *http.Server, stopWork context.CancelFunc, working *sync.WaitGroup, log *logging.Logger) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	stopWork()
	if err := server.Shutdown(ctx); err != nil {
		log.Error("core shutdown", logging.ErrorType(err))
	}
	finished := make(chan struct{})
	go func() {
		working.Wait()
		close(finished)
	}()
	select {
	case <-finished:
	case <-ctx.Done():
		log.Warn("core stopped with jobs still running: they are handed back after their lease")
	}
	log.Info("core stopped")
}
