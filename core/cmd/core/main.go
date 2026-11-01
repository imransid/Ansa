// Command core starts ansa's backend service: it reads the settings, opens
// the database, starts the job workers and serves the routes. See
// docs/backend/architecture.md for what core does.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"ansa/core/internal/alerts"
	"ansa/core/internal/api"
	"ansa/core/internal/assignments"
	"ansa/core/internal/assistant"
	"ansa/core/internal/autopost"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/chat"
	"ansa/core/internal/config"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/inbound"
	"ansa/core/internal/inbox"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/messenger"
	"ansa/core/internal/orders"
	"ansa/core/internal/outbox"
	"ansa/core/internal/publishing"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
	"ansa/core/internal/schedule"
	"ansa/core/internal/secure"
	"ansa/core/internal/session"
	"ansa/core/internal/social"
	"ansa/core/internal/socialconnect"
	"ansa/core/internal/telegram"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// How many jobs run at once in one core process. The database pool has 10
// connections; this leaves room for the webhooks.
const workerCount = 4

// The brain's longest answer: Claude Code (development) takes up to 90 s.
const brainTimeout = 120 * time.Second

func main() {
	log := logging.New(os.Stdout)
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		// The message names the settings, never their values.
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	box, err := secure.NewBox(cfg.DataEncryptionKey)
	if err != nil {
		os.Stderr.WriteString("settings: DATA_ENCRYPTION_KEY can't be used\n")
		os.Exit(1)
	}
	pool, err := database.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	defer pool.Close()

	limiter := ratelimit.New(pool, cfg.AuthSecret)
	sender := chatSender(cfg, pool, box)
	runner := &assistant.Runner{Pool: pool, Box: box, Limiter: limiter, Log: log, Chat: sender,
		Brain: brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainTimeout)}
	mail := &email.Sender{Real: cfg.SendRealEmail, ResendKey: cfg.ResendAPIKey, DevFolder: cfg.DevFolder, FromAddress: cfg.EmailFrom}
	deliverer := &outbox.Deliverer{Pool: pool, Limiter: limiter, Email: mail, ForwardingDomain: cfg.ForwardingDomain()}
	worker := newWorker(cfg, pool, box, limiter, runner, mail, log)
	worker.Handle(tickets.DeliverJobKind, deliverer.HandleJob)
	processor := &inbound.Processor{Pool: pool, Box: box, Limiter: limiter, Log: log,
		Fetcher: &resend.Fetcher{Real: cfg.SendRealEmail, APIKey: cfg.ResendAPIKey, DevFolder: cfg.DevFolder},
		Brain:   brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainTimeout), EmailFrom: cfg.EmailFrom, ForwardingDomain: cfg.ForwardingDomain()}
	worker.Handle(resend.ProcessJobKind, processor.HandleJob)
	routes := http.NewServeMux()
	routes.HandleFunc("GET /health", healthCheck(pool))
	routes.Handle("POST /webhooks/telegram", &telegram.Webhook{Pool: pool, Limiter: limiter, Box: box, Log: log, Secret: cfg.TelegramWebhookSecret, BotToken: cfg.TelegramBotToken})
	messengerHook := &messenger.Webhook{Pool: pool, Limiter: limiter, Box: box, Log: log, AppID: cfg.FacebookAppID, AppSecret: cfg.FacebookAppSecret, VerifyToken: cfg.MessengerVerifyToken}
	routes.Handle("POST /webhooks/messenger", messengerHook)
	routes.HandleFunc("GET /webhooks/messenger", messengerHook.Verify)
	routes.Handle("POST /webhooks/resend", &resend.Webhook{Pool: pool, Limiter: limiter, Log: log, Secret: cfg.ResendWebhookSecret, ForwardingDomain: cfg.ForwardingDomain()})
	// Two AI answers at most per post, each up to 60 s a try with one retry.
	postWriter := &autopost.Writer{Pool: pool, Box: box, Brain: brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, 130*time.Second), Log: log}
	screensAPI := &api.Server{Pool: pool, Box: box, Limiter: limiter, Log: log, Secret: cfg.ScreensSharedSecret,
		Sessions:    &session.Reader{Pool: pool, Secret: cfg.AuthSecret},
		Orders:      &orders.StatusChange{Pool: pool, Box: box, Sender: sender},
		Replies:     &inbox.Replies{Pool: pool, Box: box, Sender: sender},
		Brain:       brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, 5*time.Second),
		Assistant:   runner,
		MenuBrain:   brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, 260*time.Second),
		TelegramBot: cfg.TelegramBotUsername, Development: !cfg.IsProduction(), ForwardingDomain: cfg.ForwardingDomain(),
		Outbox: deliverer, Inbound: processor, Posts: postWriter,
		Social: &socialconnect.Connector{Pool: pool, Box: box, Log: log, AppID: cfg.FacebookAppID, AppSecret: cfg.FacebookAppSecret, AppURL: cfg.AppURL, Development: !cfg.IsProduction()}}
	screensAPI.Register(routes)
	server := httpserver.New(cfg.ListenAddr, routes, log)

	workCtx, stopWork := context.WithCancel(context.Background())
	var working sync.WaitGroup
	for range workerCount {
		working.Add(1)
		go func() {
			defer working.Done()
			worker.Run(workCtx)
		}()
	}
	publisher := &publishing.Runner{Pool: pool, Box: box, Limiter: limiter, Log: log, FacebookAppSecret: cfg.FacebookAppSecret,
		StandInsAllowed: !cfg.IsProduction(), StandInDir: filepath.Join(cfg.DevFolder, ".dev-social"), PublishFacebook: publishing.PublishToFacebook}
	go schedule.Run(workCtx, log, scheduledTasks(pool, publisher, postWriter))
	go func() {
		log.Info("core started")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("core stopped", logging.ErrorType(err))
			os.Exit(1)
		}
	}()
	waitForStop(server, stopWork, &working, log)
}

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
func scheduledTasks(pool *database.Pool, publisher *publishing.Runner, postWriter *autopost.Writer) []schedule.Task {
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
