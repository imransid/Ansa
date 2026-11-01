# config (core/internal/config)

**What:** reads core's settings from the environment once, at start.
**Rules:** every problem is reported at once; a message names the setting and
the rule, never the value; `Config.String()` never prints a secret.
**Settings:** CORE_LISTEN_ADDR, DATABASE_URL, DATA_ENCRYPTION_KEY, BRAIN_URL,
BRAIN_SHARED_SECRET, ANSA_ENV (see `core/.env.core.example`).
**Adding a setting:** the struct, `Load`, `.env.core.example` and this page, together.
**Tests:** `config_test.go`: good settings load with defaults; bad ones are named, never shown.
