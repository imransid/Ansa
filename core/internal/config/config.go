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
	// "development" or "production". Missing = production: a forgotten
	// setting never lets the development stand-ins in.
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
	// Resend's webhook signing secret ("whsec_..."); empty: the webhook refuses all.
	ResendWebhookSecret string
	// The domain of every company's forwarding address
	// (c-<token>@INBOUND_EMAIL_DOMAIN). Never change it once companies forward
	// to it. Required with real email; development: inbound.ansa.test.
	InboundEmailDomain string
	// ansa's Meta app (both or neither): Facebook Pages and Messenger. The
	// secret signs every Messenger webhook. MessengerVerifyToken answers
	// Meta's one-time setup check (32-256 letters, digits, _ or -).
	FacebookAppID        string
	FacebookAppSecret    string
	MessengerVerifyToken string
	// WhatsApp Business (step 56), on the same Meta app: the WhatsApp
	// webhook's one-time setup check (as MessengerVerifyToken), and the
	// Embedded Signup configuration (a Facebook Login for Business
	// configuration's id) the Connect WhatsApp button opens.
	WhatsAppVerifyToken    string
	WhatsAppSignupConfigID string
	// Signs every request the screens (Next.js's server) send core's API (at
	// least 32 characters; the same value in the screens' settings). Empty:
	// the API refuses every request.
	ScreensSharedSecret string
	// Where development stand-ins write (.dev-emails, .dev-messages): the
	// repository's root by default, the folder the old backend writes to.
	DevFolder string
	// Private files go to Cloudflare R2 only when USE_R2_STORAGE is exactly
	// "true" (then all four R2_ settings are required); otherwise to
	// <DevFolder>/.dev-files. Production requires R2.
	UseR2                                                   bool
	R2AccountID, R2AccessKeyID, R2SecretAccessKey, R2Bucket string
	// Real payments only when USE_STRIPE is exactly "true" (then
	// STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and each package's price,
	// STRIPE_PRICE_ID_PERSONAL, _BUSINESS and _PRO, are required: step 57).
	UseStripe                                                bool
	StripeSecretKey, StripeWebhookSecret                     string
	StripePricePersonal, StripePriceBusiness, StripePricePro string
	// Vapi (phone calls): the webhook's signing secret (empty: the webhook
	// refuses all) and how Vapi signs, as settings so its real format can be
	// matched without code changes (the old backend's VAPI_* settings).
	VapiWebhookSecret, VapiSignatureHeader, VapiTimestampHeader         string
	VapiSignatureAlgorithm, VapiSignaturePayload, VapiSignatureEncoding string
	VapiSignaturePrefix, VapiTimestampUnit                              string
	VapiToleranceSeconds                                                int
	// Hosts recordings are copied from (VAPI_RECORDING_HOSTS, comma-separated).
	VapiRecordingHosts []string
	// CORE_SCHEDULER=off: this process serves requests but runs none of the
	// periodic work (publishing, Post for me, numbers, catch-up, cleanup):
	// a second core beside a running one, or a preview.
	SchedulerOff bool
	// ansa's app on LinkedIn, X and YouTube (GOOGLE_), each pair both or
	// neither (social.go): connecting accounts, posting, their numbers.
	LinkedInClientID, LinkedInClientSecret, XClientID, XClientSecret, GoogleClientID, GoogleClientSecret string
	// MEDIA_PROVIDER: the image service ("" or "dev-stand-in"). Unset in
	// development is the stand-in; production refuses the stand-in, so
	// image generation is off there until a real service is chosen.
	MediaProvider string
	// The ansa phone app (devices.go): DEVICE_API_URL is how a phone reaches
	// core (it goes into the pairing QR code; required in production, https).
	// DEVICE_LISTEN_ADDR (development only, unset by default) makes core
	// also listen there for the app's routes only, so a real phone on the
	// Wi-Fi reaches the laptop while CORE_LISTEN_ADDR stays on 127.0.0.1.
	DeviceAPIURL, DeviceListenAddr string
}

// Getenv reads one setting; os.Getenv in production, a map in tests.
type Getenv func(name string) string

// Load reads and checks every setting. All problems are reported at once.
func Load(getenv Getenv) (Config, error) {
	cfg := Config{
		ListenAddr:             withDefault(getenv("CORE_LISTEN_ADDR"), "127.0.0.1:8080"),
		DatabaseURL:            getenv("DATABASE_URL"),
		DataEncryptionKey:      getenv("DATA_ENCRYPTION_KEY"),
		BrainURL:               withDefault(getenv("BRAIN_URL"), "http://127.0.0.1:8090"),
		BrainSharedSecret:      getenv("BRAIN_SHARED_SECRET"),
		Environment:            withDefault(getenv("ANSA_ENV"), "production"),
		AuthSecret:             getenv("BETTER_AUTH_SECRET"),
		TelegramBotToken:       getenv("TELEGRAM_BOT_TOKEN"),
		TelegramBotUsername:    getenv("TELEGRAM_BOT_USERNAME"),
		TelegramWebhookSecret:  getenv("TELEGRAM_WEBHOOK_SECRET"),
		AppURL:                 withDefault(getenv("APP_URL"), "http://localhost:3000"),
		SendRealEmail:          getenv("SEND_REAL_EMAIL") == "true",
		EmailFrom:              getenv("EMAIL_FROM"),
		ResendAPIKey:           getenv("RESEND_API_KEY"),
		DevFolder:              withDefault(getenv("ANSA_DEV_FOLDER"), ".."),
		ScreensSharedSecret:    getenv("SCREENS_SHARED_SECRET"),
		InboundEmailDomain:     strings.ToLower(strings.TrimSpace(getenv("INBOUND_EMAIL_DOMAIN"))),
		ResendWebhookSecret:    getenv("RESEND_WEBHOOK_SECRET"),
		FacebookAppID:          getenv("FACEBOOK_APP_ID"),
		FacebookAppSecret:      getenv("FACEBOOK_APP_SECRET"),
		MessengerVerifyToken:   getenv("MESSENGER_VERIFY_TOKEN"),
		WhatsAppVerifyToken:    getenv("WHATSAPP_VERIFY_TOKEN"),
		WhatsAppSignupConfigID: getenv("WHATSAPP_SIGNUP_CONFIG_ID"),
		UseR2:                  getenv("USE_R2_STORAGE") == "true",
		R2AccountID:            getenv("R2_ACCOUNT_ID"),
		R2AccessKeyID:          getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey:      getenv("R2_SECRET_ACCESS_KEY"),
		R2Bucket:               getenv("R2_BUCKET"),
		UseStripe:              getenv("USE_STRIPE") == "true",
		StripeSecretKey:        getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret:    getenv("STRIPE_WEBHOOK_SECRET"),
		StripePricePersonal:    getenv("STRIPE_PRICE_ID_PERSONAL"),
		StripePriceBusiness:    getenv("STRIPE_PRICE_ID_BUSINESS"),
		StripePricePro:         getenv("STRIPE_PRICE_ID_PRO"),
		SchedulerOff:           getenv("CORE_SCHEDULER") == "off",
		MediaProvider:          getenv("MEDIA_PROVIDER"),
	}
	readVapi(&cfg, getenv)
	readSocialApps(&cfg, getenv)
	readDevices(&cfg, getenv)
	problems := socialAppProblems(cfg)
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
	problems = append(problems, metaProblems(cfg)...)
	problems = append(problems, mediaProblems(cfg)...)
	problems = append(problems, storageProblems(cfg)...)
	problems = append(problems, stripeProblems(cfg)...)
	problems = append(problems, vapiProblems(cfg)...)
	problems = append(problems, deviceProblems(cfg)...)
	if cfg.ScreensSharedSecret != "" && len(cfg.ScreensSharedSecret) < 32 {
		problems = append(problems, "SCREENS_SHARED_SECRET must be at least 32 characters (openssl rand -hex 32)")
	}
	if len(problems) > 0 {
		return Config{}, errors.New("settings: " + strings.Join(problems, "; "))
	}
	return cfg, nil
}

// ForwardingDomain is the domain forwarding addresses are on.
func (c Config) ForwardingDomain() string {
	if c.InboundEmailDomain == "" {
		return "inbound.ansa.test"
	}
	return c.InboundEmailDomain
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
