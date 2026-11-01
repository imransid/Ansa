// Package config reads core's settings from the environment once, at start,
// and stops the service with a clear message when one is missing or wrong.
// The message names the setting and the rule, never its value
// (docs/backend/security.md, rule 2).
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Config is every setting core reads. Add a field here, in Load, in
// core/.env.example and in docs/backend/modules/config.md together.
type Config struct {
	// Where core listens, e.g. "127.0.0.1:8080".
	ListenAddr string
	// PostgreSQL, e.g. "postgres://user:pass@localhost:5432/ansa".
	DatabaseURL string
	// 32 bytes as base64: the same key as the old backend's DATA_ENCRYPTION_KEY.
	DataEncryptionKey string
	// The brain's private address, e.g. "http://127.0.0.1:8090".
	BrainURL string
	// Signs every request core sends the brain (at least 32 characters).
	BrainSharedSecret string
	// "development" or "production".
	Environment string
	// The old backend's BETTER_AUTH_SECRET: rate limit keys are derived from
	// it the same way (both backends share counters), and logins move here later.
	AuthSecret string
	// Telegram (all three or none): ansa's bot token, its username, and the
	// webhook secret Telegram sends back. Without them the webhook refuses all.
	TelegramBotToken      string
	TelegramBotUsername   string
	TelegramWebhookSecret string
	// The screens' address, for links in emails and alerts (the old
	// BETTER_AUTH_URL's value). Development: http://localhost:3000.
	AppURL string
	// Email: real only when SEND_REAL_EMAIL is exactly "true" (then
	// EMAIL_FROM and RESEND_API_KEY are required; production requires it).
	// Otherwise every email is a file in <DevFolder>/.dev-emails.
	SendRealEmail bool
	EmailFrom     string
	ResendAPIKey  string
	// Where development stand-ins write (.dev-emails, .dev-messages): the
	// repository's root by default, the folder the old backend writes to.
	DevFolder string
}

// Getenv reads one setting; os.Getenv in production, a map in tests.
type Getenv func(name string) string

// Load reads and checks every setting. All problems are reported at once.
func Load(getenv Getenv) (Config, error) {
	cfg := Config{
		ListenAddr:            withDefault(getenv("CORE_LISTEN_ADDR"), "127.0.0.1:8080"),
		DatabaseURL:           getenv("DATABASE_URL"),
		DataEncryptionKey:     getenv("DATA_ENCRYPTION_KEY"),
		BrainURL:              withDefault(getenv("BRAIN_URL"), "http://127.0.0.1:8090"),
		BrainSharedSecret:     getenv("BRAIN_SHARED_SECRET"),
		Environment:           withDefault(getenv("ANSA_ENV"), "development"),
		AuthSecret:            getenv("BETTER_AUTH_SECRET"),
		TelegramBotToken:      getenv("TELEGRAM_BOT_TOKEN"),
		TelegramBotUsername:   getenv("TELEGRAM_BOT_USERNAME"),
		TelegramWebhookSecret: getenv("TELEGRAM_WEBHOOK_SECRET"),
		AppURL:                withDefault(getenv("APP_URL"), "http://localhost:3000"),
		SendRealEmail:         getenv("SEND_REAL_EMAIL") == "true",
		EmailFrom:             getenv("EMAIL_FROM"),
		ResendAPIKey:          getenv("RESEND_API_KEY"),
		DevFolder:             withDefault(getenv("ANSA_DEV_FOLDER"), ".."),
	}
	var problems []string
	if !strings.HasPrefix(cfg.DatabaseURL, "postgres://") && !strings.HasPrefix(cfg.DatabaseURL, "postgresql://") {
		problems = append(problems, "DATABASE_URL must be a postgres:// address")
	}
	if key, err := base64.StdEncoding.DecodeString(cfg.DataEncryptionKey); err != nil || len(key) != 32 {
		problems = append(problems, "DATA_ENCRYPTION_KEY must be 32 bytes written as base64 (the old backend's key)")
	}
	if brain, err := url.Parse(cfg.BrainURL); err != nil || (brain.Scheme != "http" && brain.Scheme != "https") || brain.Host == "" {
		problems = append(problems, "BRAIN_URL must be an http(s) address")
	}
	if len(cfg.BrainSharedSecret) < 32 {
		problems = append(problems, "BRAIN_SHARED_SECRET must be at least 32 characters (openssl rand -hex 32)")
	}
	if len(cfg.AuthSecret) < 32 {
		problems = append(problems, "BETTER_AUTH_SECRET must be at least 32 characters (the old backend's value)")
	}
	setTelegram := 0
	for _, value := range []string{cfg.TelegramBotToken, cfg.TelegramBotUsername, cfg.TelegramWebhookSecret} {
		if value != "" {
			setTelegram++
		}
	}
	if setTelegram != 0 && setTelegram != 3 {
		problems = append(problems, "TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET must be set together")
	}
	if cfg.TelegramWebhookSecret != "" && len(cfg.TelegramWebhookSecret) < 32 {
		problems = append(problems, "TELEGRAM_WEBHOOK_SECRET must be at least 32 characters")
	}
	if cfg.Environment != "development" && cfg.Environment != "production" {
		problems = append(problems, `ANSA_ENV must be "development" or "production"`)
	}
	problems = append(problems, emailAndLinkProblems(cfg)...)
	if len(problems) > 0 {
		return Config{}, errors.New("settings: " + strings.Join(problems, "; "))
	}
	return cfg, nil
}

// emailAndLinkProblems checks the screens' address and the email settings.
func emailAndLinkProblems(cfg Config) []string {
	var problems []string
	app, err := url.Parse(cfg.AppURL)
	if err != nil || app.Host == "" || (app.Scheme != "https" && !(app.Scheme == "http" && cfg.Environment == "development")) {
		problems = append(problems, "APP_URL must be the screens' https address (http only in development)")
	}
	if cfg.Environment == "production" && !cfg.SendRealEmail {
		problems = append(problems, `SEND_REAL_EMAIL must be "true" in production`)
	}
	if cfg.SendRealEmail && (!strings.Contains(cfg.EmailFrom, "@") || cfg.ResendAPIKey == "") {
		problems = append(problems, "SEND_REAL_EMAIL needs EMAIL_FROM (an address) and RESEND_API_KEY")
	}
	return problems
}

// IsProduction is true in production, where development stand-ins are refused.
func (c Config) IsProduction() bool {
	return c.Environment == "production"
}

func withDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// String never prints a secret: only which settings are set.
func (c Config) String() string {
	return fmt.Sprintf("listen=%s brain=%s env=%s", c.ListenAddr, c.BrainURL, c.Environment)
}
