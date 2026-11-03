package config

import (
	"net/url"
	"regexp"
	"strings"
)

// The checks of each group of settings, apart from Load (the ~200-line rule).

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
	if cfg.SendRealEmail && (!strings.Contains(cfg.EmailFrom, "@") || cfg.ResendAPIKey == "" || cfg.InboundEmailDomain == "") {
		problems = append(problems, "SEND_REAL_EMAIL needs EMAIL_FROM (an address), RESEND_API_KEY and INBOUND_EMAIL_DOMAIN")
	}
	if cfg.ResendWebhookSecret != "" && !strings.HasPrefix(cfg.ResendWebhookSecret, "whsec_") {
		problems = append(problems, `RESEND_WEBHOOK_SECRET must be Resend's signing secret (it starts with "whsec_")`)
	}
	if cfg.InboundEmailDomain != "" && !domainPattern.MatchString(cfg.InboundEmailDomain) {
		problems = append(problems, "INBOUND_EMAIL_DOMAIN must be a domain name like inbound.yourdomain.com")
	}
	return problems
}

var domainPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

var verifyTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{32,256}$`)

// metaProblems checks ansa's Meta app settings.
func metaProblems(cfg Config) []string {
	var problems []string
	if (cfg.FacebookAppID == "") != (cfg.FacebookAppSecret == "") {
		problems = append(problems, "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set together")
	}
	if cfg.MessengerVerifyToken != "" && !verifyTokenPattern.MatchString(cfg.MessengerVerifyToken) {
		problems = append(problems, "MESSENGER_VERIFY_TOKEN must be 32 to 256 letters, digits, _ or - (openssl rand -hex 32)")
	}
	if cfg.WhatsAppVerifyToken != "" && !verifyTokenPattern.MatchString(cfg.WhatsAppVerifyToken) {
		problems = append(problems, "WHATSAPP_VERIFY_TOKEN must be 32 to 256 letters, digits, _ or - (openssl rand -hex 32)")
	}
	if cfg.WhatsAppSignupConfigID != "" && (!metaIDPattern.MatchString(cfg.WhatsAppSignupConfigID) || cfg.FacebookAppID == "") {
		problems = append(problems, "WHATSAPP_SIGNUP_CONFIG_ID must be the digits of a Facebook Login for Business configuration, with FACEBOOK_APP_ID and FACEBOOK_APP_SECRET set")
	}
	return problems
}

var metaIDPattern = regexp.MustCompile(`^[0-9]{1,40}$`)

// mediaProblems checks the media library's image service.
func mediaProblems(cfg Config) []string {
	if cfg.MediaProvider != "" && cfg.MediaProvider != "dev-stand-in" {
		return []string{`MEDIA_PROVIDER must be empty or "dev-stand-in" (no real image service is chosen yet)`}
	}
	return nil
}

// stripeProblems checks the payment settings.
func stripeProblems(cfg Config) []string {
	if cfg.UseStripe && (cfg.StripeSecretKey == "" || cfg.StripeWebhookSecret == "" || cfg.StripePriceID == "") {
		return []string{"USE_STRIPE=true needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID"}
	}
	return nil
}

// storageProblems checks the private file storage's settings.
func storageProblems(cfg Config) []string {
	switch {
	case cfg.UseR2 && (cfg.R2AccountID == "" || cfg.R2AccessKeyID == "" || cfg.R2SecretAccessKey == "" || cfg.R2Bucket == ""):
		return []string{"USE_R2_STORAGE=true needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET"}
	case !cfg.UseR2 && cfg.IsProduction():
		return []string{"production needs USE_R2_STORAGE=true: the development folder is no place for customers' files"}
	}
	return nil
}
