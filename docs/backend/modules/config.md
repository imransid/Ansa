# config (core/internal/config)

**What:** reads core's settings from the environment once, at start.
**Rules:** every problem is reported at once; a message names the setting and
the rule, never the value; `Config.String()` never prints a secret.
**Settings:** CORE_LISTEN_ADDR, DATABASE_URL, DATA_ENCRYPTION_KEY, BRAIN_URL,
BRAIN_SHARED_SECRET, ANSA_ENV, BETTER_AUTH_SECRET (rate limit keys, shared
with the old backend), TELEGRAM_BOT_TOKEN / _USERNAME / TELEGRAM_WEBHOOK_SECRET
(all or none), APP_URL (the screens' address for links: https, http only in
development), SEND_REAL_EMAIL (exactly "true" sends through Resend and then
needs EMAIL_FROM and RESEND_API_KEY; production requires it), ANSA_DEV_FOLDER
(where development stand-ins write `.dev-emails/` and `.dev-messages/`: the
repository's root by default), FACEBOOK_APP_ID / FACEBOOK_APP_SECRET
(ansa's Meta app, both or neither: its secret signs Messenger's webhook),
MESSENGER_VERIFY_TOKEN (Meta's one-time setup check, 32-256 letters, digits,
_ or -), SCREENS_SHARED_SECRET (signs the screens' requests to core's API, at
least 32 characters), INBOUND_EMAIL_DOMAIN (forwarding addresses' domain;
required with real email), RESEND_WEBHOOK_SECRET (Resend's "whsec_..." signing secret),
USE_R2_STORAGE (exactly "true" keeps private files in Cloudflare R2, then
needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET;
production requires it; otherwise `<ANSA_DEV_FOLDER>/.dev-files/`), USE_STRIPE (exactly
"true" takes real payments, then needs STRIPE_SECRET_KEY,
STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID). The checks of each group live in
`checks.go`. See `core/.env.core.example`.
**Adding a setting:** the struct, `Load`, `.env.core.example` and this page, together.
**Tests:** `config_test.go`: good settings load with defaults; bad ones are
named, never shown; real email needs its sender; production needs real email
and an https address.
