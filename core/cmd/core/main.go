// Command core starts ansa's backend service: it reads the settings, opens
// the database, starts the job workers and serves the routes. See
// docs/backend/architecture.md for what core does.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"ansa/core/internal/accounts"
	"ansa/core/internal/api"
	"ansa/core/internal/assistant"
	"ansa/core/internal/autopost"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/config"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/inbound"
	"ansa/core/internal/inbox"
	"ansa/core/internal/logging"
	"ansa/core/internal/messenger"
	"ansa/core/internal/orders"
	"ansa/core/internal/outbox"
	"ansa/core/internal/postmetrics"
	"ansa/core/internal/publishing"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
	"ansa/core/internal/safefetch"
	"ansa/core/internal/schedule"
	"ansa/core/internal/secure"
	"ansa/core/internal/session"
	"ansa/core/internal/socialconnect"
	"ansa/core/internal/telegram"
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
		Outbox: deliverer, Inbound: processor, Posts: postWriter, AppURL: cfg.AppURL, Files: fileStore(cfg), EmailFrom: cfg.EmailFrom, WebFetcher: &safefetch.Fetcher{},
		Accounts: &accounts.Service{Pool: pool, Secret: cfg.AuthSecret, AppURL: cfg.AppURL, Mail: mail, Limits: limiter, Log: log},
		Social:   &socialconnect.Connector{Pool: pool, Box: box, Log: log, AppID: cfg.FacebookAppID, AppSecret: cfg.FacebookAppSecret, AppURL: cfg.AppURL, Development: !cfg.IsProduction()}}
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
	numbers := &postmetrics.Collector{Pool: pool, Box: box, Log: log, FacebookAppSecret: cfg.FacebookAppSecret, ReadFacebook: postmetrics.ReadFacebook}
	go schedule.Run(workCtx, log, scheduledTasks(pool, log, publisher, postWriter, numbers))
	go func() {
		log.Info("core started")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("core stopped", logging.ErrorType(err))
			os.Exit(1)
		}
	}()
	waitForStop(server, stopWork, &working, log)
}
