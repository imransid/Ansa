package main

import (
	"net/http"
	"path/filepath"

	"ansa/core/internal/accounts"
	"ansa/core/internal/analytics"
	"ansa/core/internal/api"
	"ansa/core/internal/assistant"
	"ansa/core/internal/autopost"
	"ansa/core/internal/billing"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/calls"
	"ansa/core/internal/comments"
	"ansa/core/internal/config"
	"ansa/core/internal/database"
	"ansa/core/internal/devices"
	"ansa/core/internal/email"
	"ansa/core/internal/files"
	"ansa/core/internal/inbound"
	"ansa/core/internal/inbox"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/mediagen"
	"ansa/core/internal/messenger"
	"ansa/core/internal/orders"
	"ansa/core/internal/outbox"
	"ansa/core/internal/phone"
	"ansa/core/internal/postmetrics"
	"ansa/core/internal/publishing"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
	"ansa/core/internal/safefetch"
	"ansa/core/internal/schedule"
	"ansa/core/internal/secure"
	"ansa/core/internal/session"
	"ansa/core/internal/social"
	"ansa/core/internal/socialconnect"
	"ansa/core/internal/studio"
	"ansa/core/internal/telegram"
	"ansa/core/internal/tickets"
	"ansa/core/internal/whatsapp"
)

// parts is everything core runs, put together from the settings: the routes
// (the webhooks and the screens' API), the job worker, and the periodic work.
// main serves and runs them; the journey test (journey_test.go) drives the
// very same parts.
type parts struct {
	routes *http.ServeMux
	// The ansa phone app's routes alone: the development LAN listener
	// (DEVICE_LISTEN_ADDR) serves only these.
	deviceRoutes *http.ServeMux
	worker       *jobs.Worker
	tasks        []schedule.Task
	publisher    *publishing.Runner
	postWriter   *autopost.Writer
}

// assemble puts core together.
func assemble(cfg config.Config, pool *database.Pool, box *secure.Box, log *logging.Logger) *parts {
	limiter := ratelimit.New(pool, cfg.AuthSecret)
	sender := chatSender(cfg, pool, box)
	runner := &assistant.Runner{Pool: pool, Box: box, Limiter: limiter, Log: log, Chat: sender,
		Brain: brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.AssistantReplyWait)}
	mail := &email.Sender{Real: cfg.SendRealEmail, ResendKey: cfg.ResendAPIKey, DevFolder: cfg.DevFolder, FromAddress: cfg.EmailFrom}
	deliverer := &outbox.Deliverer{Pool: pool, Limiter: limiter, Email: mail, ForwardingDomain: cfg.ForwardingDomain()}
	worker := newWorker(cfg, pool, box, limiter, runner, mail, log)
	worker.Handle(tickets.DeliverJobKind, deliverer.HandleJob)
	processor := &inbound.Processor{Pool: pool, Box: box, Limiter: limiter, Log: log,
		Fetcher: &resend.Fetcher{Real: cfg.SendRealEmail, APIKey: cfg.ResendAPIKey, DevFolder: cfg.DevFolder},
		Brain:   brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.EmailTriageWait), EmailFrom: cfg.EmailFrom, ForwardingDomain: cfg.ForwardingDomain()}
	worker.Handle(resend.ProcessJobKind, processor.HandleJob)
	// Each brain client waits as long as its use may take at the brain
	// (brainclient/waits.go, checked against the brain's own limits).
	callAnalyzer := &calls.Analyzer{Pool: pool, Box: box, Log: log, Brain: brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.CallDecisionWait)}
	worker.Handle(calls.AnalyzeJobKind, callAnalyzer.HandleJob)
	// Comments on the business's Facebook posts: answered by a job, sent
	// through Meta (or, in development, the stand-in Page's folder).
	commentAnswers := &comments.Answerer{Pool: pool, Box: box, Limiter: limiter, Log: log, MetaAppSecret: cfg.FacebookAppSecret,
		Brain:           brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.CommentReplyWait),
		StandInsAllowed: !cfg.IsProduction(), StandInDir: filepath.Join(cfg.DevFolder, ".dev-messages")}
	worker.Handle(comments.AnswerJobKind, commentAnswers.HandleJob)
	storage := fileStore(cfg)
	// LinkedIn, X and YouTube; the renewer gets any account ready for a
	// platform call (the only place a token is renewed).
	connectors := socialPlatforms(cfg)
	renewer := &social.Renewer{Pool: pool, Box: box, Platforms: connectors}
	stripe := &billing.Stripe{SecretKey: cfg.StripeSecretKey,
		Prices: map[string]string{"personal": cfg.StripePricePersonal, "business": cfg.StripePriceBusiness, "pro": cfg.StripePricePro}}
	routes := http.NewServeMux()
	routes.HandleFunc("GET /health", healthCheck(pool))
	addWebhooks(routes, cfg, pool, box, limiter, log, storage, stripe)
	// The ansa phone app's calls, on core's own address too (production,
	// behind https).
	phoneApp := &devices.API{Pool: pool, Limiter: limiter, Log: log}
	phoneApp.Register(routes)
	// Two AI answers at most per post, each up to 60 s a try with one retry.
	postWriter := &autopost.Writer{Pool: pool, Box: box, Brain: brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.AutopostWait), Log: log}
	screensAPI := &api.Server{Pool: pool, Box: box, Limiter: limiter, Log: log, Secret: cfg.ScreensSharedSecret,
		Sessions:  &session.Reader{Pool: pool, Secret: cfg.AuthSecret},
		Orders:    &orders.StatusChange{Pool: pool, Box: box, Sender: sender},
		Replies:   &inbox.Replies{Pool: pool, Box: box, Sender: sender},
		Brain:     brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.StatusWait),
		Assistant: runner,
		Phone: &phone.Service{Pool: pool, Box: box, Assistant: runner, Log: log,
			Brain: brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.VoiceWait)},
		MenuBrain:   brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.MenuReadingWait),
		TelegramBot: cfg.TelegramBotUsername, Development: !cfg.IsProduction(), ForwardingDomain: cfg.ForwardingDomain(), DevMailFolder: devMailFolder(cfg),
		Outbox: deliverer, Inbound: processor, Posts: postWriter, AppURL: cfg.AppURL, Files: storage, EmailFrom: cfg.EmailFrom, WebFetcher: &safefetch.Fetcher{AppURL: cfg.AppURL},
		Accounts:    &accounts.Service{Pool: pool, Secret: cfg.AuthSecret, AppURL: cfg.AppURL, Mail: mail, Limits: limiter, Log: log},
		BillingMode: billing.Mode(cfg.UseStripe, cfg.IsProduction()), Stripe: stripe, Calls: callAnalyzer,
		Social: &socialconnect.Connector{Pool: pool, Box: box, Log: log, AppID: cfg.FacebookAppID, AppSecret: cfg.FacebookAppSecret, AppURL: cfg.AppURL, Development: !cfg.IsProduction(),
			Platforms: connectors}}
	screensAPI.Reviews = &analytics.Reviewer{Pool: pool, Limiter: limiter, Log: log, Brain: brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.PerformanceReviewWait)}
	// The content studio's AI drafts and the media library's image service.
	generations := &mediagen.Service{Pool: pool, Files: storage, Limiter: limiter, Log: log, Mode: mediagen.ModeFor(cfg.MediaProvider, cfg.IsProduction())}
	screensAPI.Studio = &api.StudioServices{Writer: &studio.Writer{Pool: pool, Brain: brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.ContentDraftWait), Limiter: limiter, Log: log},
		Generation: generations}
	screensAPI.CofounderBrain = brainclient.New(cfg.BrainURL, cfg.BrainSharedSecret, brainclient.CofounderWait)
	// Core's address for the ansa phone app, inside the pairing QR code.
	screensAPI.DeviceAPIURL = cfg.DeviceAPIURL
	screensAPI.WhatsApp = &whatsapp.Connector{Pool: pool, Box: box, AppID: cfg.FacebookAppID, AppSecret: cfg.FacebookAppSecret,
		SignupConfigID: cfg.WhatsAppSignupConfigID, Development: !cfg.IsProduction()}
	publisher := &publishing.Runner{Pool: pool, Box: box, Limiter: limiter, Log: log, Files: storage, FacebookAppSecret: cfg.FacebookAppSecret,
		StandInsAllowed: !cfg.IsProduction(), StandInDir: filepath.Join(cfg.DevFolder, ".dev-social"), PublishFacebook: publishing.PublishToFacebook,
		OtherSenders: connectorSenders(renewer, connectors)}
	// Posts made due by an answer (Publish now, Retry, now) go out right after it.
	screensAPI.Publisher = publisher
	screensAPI.Register(routes)
	numbers := &postmetrics.Collector{Pool: pool, Box: box, Log: log, FacebookAppSecret: cfg.FacebookAppSecret, ReadFacebook: postmetrics.ReadFacebook,
		Renewer: renewer, Platforms: connectors}
	return &parts{routes: routes, deviceRoutes: devices.OnlyDeviceRoutes(phoneApp), worker: worker,
		tasks: scheduledTasks(pool, log, publisher, postWriter, numbers, generations), publisher: publisher, postWriter: postWriter}
}

// addWebhooks adds the routes the outside services call: each checks its
// own signature before reading anything.
func addWebhooks(routes *http.ServeMux, cfg config.Config, pool *database.Pool, box *secure.Box, limiter *ratelimit.Limiter, log *logging.Logger, storage *files.Store, stripe *billing.Stripe) {
	routes.Handle("POST /webhooks/telegram", &telegram.Webhook{Pool: pool, Limiter: limiter, Box: box, Log: log, Secret: cfg.TelegramWebhookSecret, BotToken: cfg.TelegramBotToken})
	messengerHook := &messenger.Webhook{Pool: pool, Limiter: limiter, Box: box, Log: log, AppID: cfg.FacebookAppID, AppSecret: cfg.FacebookAppSecret, VerifyToken: cfg.MessengerVerifyToken,
		Comments: &comments.Saver{Pool: pool, Box: box}}
	routes.Handle("POST /webhooks/messenger", messengerHook)
	routes.HandleFunc("GET /webhooks/messenger", messengerHook.Verify)
	whatsappHook := &whatsapp.Webhook{Pool: pool, Limiter: limiter, Box: box, Log: log, AppSecret: cfg.FacebookAppSecret, VerifyToken: cfg.WhatsAppVerifyToken}
	routes.Handle("POST /webhooks/whatsapp", whatsappHook)
	routes.HandleFunc("GET /webhooks/whatsapp", whatsappHook.Verify)
	routes.Handle("POST /webhooks/vapi", &calls.Webhook{Pool: pool, Box: box, Limiter: limiter, Log: log, Signing: vapiSigning(cfg),
		RecordingHosts: cfg.VapiRecordingHosts, Files: storage, Tools: &calls.Tools{Pool: pool, Limiter: limiter, Log: log}})
	routes.Handle("POST /webhooks/resend", &resend.Webhook{Pool: pool, Limiter: limiter, Log: log, Secret: cfg.ResendWebhookSecret, ForwardingDomain: cfg.ForwardingDomain()})
	routes.Handle("POST /webhooks/stripe", &billing.Webhook{Pool: pool, Limiter: limiter, Log: log, Secret: cfg.StripeWebhookSecret, Stripe: stripe})
}
