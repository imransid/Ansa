# core: ansa's backend (Go)

Core does all the work: webhooks, messages, orders, posting, logins, payments,
background jobs, and every security rule. It is the only part that touches the
database. Read `docs/backend/README.md` first.

## Run it on your laptop
1. Copy the settings: `cp core/.env.core.example .env.core` (in the repository
   root; git ignores it), and fill in:
   - `DATABASE_URL`: the same database as the old backend (`.env.local`).
   - `DATA_ENCRYPTION_KEY`: the same key as the old backend's.
   - `BRAIN_SHARED_SECRET`: `openssl rand -hex 32`, the same value for the brain.
2. Start the brain first (see `brain/README.md`), then from `core/`:
   `make run`. Check it: `curl -i http://127.0.0.1:8080/health`.
3. In development, emails and stand-in chat replies are files in the
   repository's `.dev-emails/` and `.dev-messages/` (as the old backend's).

## Test it
From `core/`: `make check` (formatting, `go vet`, every test).

## Folders
| Folder | What | Docs |
|---|---|---|
| `cmd/core/` | Starts the service | this page |
| `internal/config/` | Settings, checked at start | [config](../docs/backend/modules/config.md) |
| `internal/logging/` | Safe JSON logs | [logging](../docs/backend/modules/logging.md) |
| `internal/secure/` | Encryption of stored text | [secure](../docs/backend/modules/secure.md) |
| `internal/tenant/` | The company id type | [tenant](../docs/backend/modules/tenant.md) |
| `internal/httpserver/` | Server, headers, size caps, /health | [httpserver](../docs/backend/modules/httpserver.md) |
| `internal/brainclient/` | Signed requests to the brain | [brainclient](../docs/backend/modules/brainclient.md) |
| `internal/database/` | PostgreSQL pool, transactions, tenant check | [database](../docs/backend/modules/database.md) |
| `internal/ratelimit/` | Attempt counters shared with the old backend | [ratelimit](../docs/backend/modules/ratelimit.md) |
| `internal/jobs/` | The job queue and its worker | [jobs](../docs/backend/modules/jobs.md) |
| `internal/conversations/` | Contacts, conversations, messages | [conversations](../docs/backend/modules/conversations.md) |
| `internal/telegram/` | The Telegram Business channel | [telegram](../docs/backend/modules/telegram.md) |
| `internal/chat/` | The one door for sending to customers | [chat](../docs/backend/modules/chat.md) |
| `internal/hours/` | Opening and away hours | [hours](../docs/backend/modules/hours.md) |
| `internal/assistant/` | The assistant: when it answers, the brain's slice, checks, replies, handovers | [assistant](../docs/backend/modules/assistant.md) |
| `internal/tickets/` | Making and routing requests | [tickets](../docs/backend/modules/tickets.md) |
| `internal/email/`, `internal/plaintext/` | The one door for sending email; one plain line | [email](../docs/backend/modules/email.md) |
| `internal/alerts/` | Telling the owners a conversation needs them | [alerts](../docs/backend/modules/alerts.md) |
| `internal/assignments/` | "A ticket is yours" emails | [assignments](../docs/backend/modules/assignments.md) |
| `internal/schedule/` | Periodic work inside the service | [schedule](../docs/backend/modules/schedule.md) |
