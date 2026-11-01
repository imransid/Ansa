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
4. Try the assistant without Telegram: with core running, from `core/`:
   `make simulate OWNER=you@example.com NAME="Lena" TEXT="Are you open tonight?"`
   (development and a local database only). The answer appears in
   `.dev-messages/` and in the Inbox.

## Test it
From `core/`: `make check` (formatting, `go vet`, every test).

## Folders
| Folder | What | Docs |
|---|---|---|
| `cmd/core/` | Starts the service | this page |
| `cmd/simulate/` | A stand-in customer's message, for trying core by hand | this page |
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
| `internal/messenger/` | The Facebook Messenger channel | [messenger](../docs/backend/modules/messenger.md) |
| `internal/social/` | The only place a social account's token is decrypted | [social](../docs/backend/modules/social.md) |
| `internal/hours/` | Opening and away hours | [hours](../docs/backend/modules/hours.md) |
| `internal/assistant/` | The assistant: when it answers, the brain's slice, checks, replies, handovers | [assistant](../docs/backend/modules/assistant.md) |
| `internal/tickets/` | Requests: making, routing, the list, a request's page and every change | [tickets](../docs/backend/modules/tickets.md), [requests](../docs/backend/modules/requests.md) |
| `internal/resend/`, `internal/inbound/` | Email in: Resend's webhook, fetching, turning an email into a request | [email-in](../docs/backend/modules/email-in.md) |
| `internal/outbox/`, `internal/addresses/` | Customer emails (the "solved" email); customer addresses | [requests](../docs/backend/modules/requests.md) |
| `internal/orders/`, `internal/money/` | Orders written up and priced by ansa; amounts in smallest units | [orders](../docs/backend/modules/orders.md) |
| `internal/email/`, `internal/plaintext/` | The one door for sending email; one plain line | [email](../docs/backend/modules/email.md) |
| `internal/alerts/` | Telling the owners a conversation needs them | [alerts](../docs/backend/modules/alerts.md) |
| `internal/assignments/` | "A ticket is yours" emails | [assignments](../docs/backend/modules/assignments.md) |
| `internal/schedule/` | Periodic work inside the service | [schedule](../docs/backend/modules/schedule.md) |
| `internal/session/` | Who is asking: Better Auth's session, read by core | [session](../docs/backend/modules/session.md) |
| `internal/api/` | The API for the screens (signed, logged in) | [api](../docs/backend/modules/api.md) |
| `internal/inbox/` | The Inbox: lists, a conversation's page, a person's work | [inbox](../docs/backend/modules/inbox.md) |
| `internal/team/` | A person's role, read again inside a write; the company row lock | [inbox](../docs/backend/modules/inbox.md) |
| `internal/home/`, `internal/settings/` | Home's reads; the owner's switches | [home](../docs/backend/modules/home.md) |
| `internal/setup/` | /welcome and Settings → What it knows | [setup](../docs/backend/modules/setup.md) |
| `internal/channels/` | Settings → Connections | [channels](../docs/backend/modules/channels.md) |
| `internal/publishing/`, `internal/drafts/`, `internal/contentrules/` | The publishing queue (Facebook text posts); content drafts; what a post may say | [publishing](../docs/backend/modules/publishing.md), [contentrules](../docs/backend/modules/contentrules.md) |
| `internal/autopost/` | "Post for me": the topic brain, posting times, writing, ansa's checks, the switch | [autopost](../docs/backend/modules/autopost.md) |
| `internal/teammates/` | The Team page: invites, roles, removing someone, categories | [teammates](../docs/backend/modules/teammates.md) |
| `internal/maintenance/` | Hourly cleanup of rows nobody can use any more | [maintenance](../docs/backend/modules/maintenance.md) |
| `internal/knowledge/` | Searching approved articles; the escaped slice the AI reads | [knowledge](../docs/backend/modules/knowledge.md) |
| `internal/postmetrics/` | Reading published posts' numbers (Facebook) | [postmetrics](../docs/backend/modules/postmetrics.md) |
| `internal/socialconnect/` | Connecting Facebook Pages (Facebook's sign-in), disconnecting | [socialconnect](../docs/backend/modules/socialconnect.md) |
| `internal/menu/`, `internal/menureading/` | The menu: dishes, prices, availability; Read my menu | [menu](../docs/backend/modules/menu.md) |
