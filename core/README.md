# core: ansa's backend (Go)

Core does all the work: webhooks, messages, orders, posting, logins, payments,
background jobs, and every security rule. It is the only part that touches the
database. Read `docs/backend/README.md` first.

## Run it on your laptop
1. Copy the settings: `cp core/.env.core.example .env.core` (in the repository
   root; git ignores it), and fill in:
   - `DATABASE_URL`: the local database (the same address as in `.env.local`).
   - `DATA_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`: made once (the example
     file says how), then never changed: they open stored text and logins.
   - `BRAIN_SHARED_SECRET`: `openssl rand -hex 32`, the same value for the brain.
   - `SCREENS_SHARED_SECRET`: `openssl rand -hex 32`, the same value in `.env.local`.
2. Start the brain first (see `brain/README.md`), then from `core/`:
   `make run`. Check it: `curl -i http://127.0.0.1:8080/health`.
3. In development, emails and stand-in chat replies are files in the
   repository's `.dev-emails/` and `.dev-messages/`.
4. Try the assistant without Telegram: with core running, from `core/`:
   `make simulate-message OWNER=you@example.com NAME="Lena" TEXT="Are you open tonight?"`
   (development and a local database only). The answer appears in
   `.dev-messages/` and in the Inbox.

## Test it
From `core/`: `make check` (formatting, `go vet`, every test; one folder:
`make test PKG=./internal/commands/`). The tests use TEST_DATABASE_URL: a
local database of its own (`ansa_test`), never the one a running core uses;
`.env.core.example` says how to make it. The tests that answer for Telegram
with a fake refuse to run while TELEGRAM_BOT_TOKEN is set.
`cmd/core/journey_test.go` drives core as `main` puts it together
(`assemble`): one business from signup to its first order and post, a fake
brain and a fake Telegram API, and a second business that finds none of it.

After changing a package's name, price or limits
(`internal/packages/packages.go`), run `make website-packages`: it writes
`internal/packages/website.json`, which the website's Pricing page reads
(the tests fail until then).

## Commands
Run from `core/` (`make <target>`, or `go run ./cmd/operator ...` /
`go run ./cmd/simulate ...`). Each reads the environment first, then
`../.env.core` for what it doesn't set, so a setting on the command line
wins. A company is found only by a confirmed, active owner's address; a
command that changes something prints the company and changes nothing
without `YES=1` (`--yes`). Every command, its flags and its guards:
[commands](../docs/backend/modules/commands.md).

ansa's operator (development and production):
| make | Does |
|---|---|
| `link-phone-line OWNER= NUMBER= [YES=1]` | Links a Vapi number to the owner's company |
| `unlink-phone-line OWNER= NUMBER= [YES=1]` | Unlinks it (only before its first call) |
| `show-forwarding-address OWNER=` | Prints the company's forwarding address (needs INBOUND_EMAIL_DOMAIN) |
| `replace-forwarding-address OWNER= [YES=1]` | A new forwarding address; the old one stops at once |
| `telegram-webhook ACTION=set URL=https://<core's public address>` or `ACTION=remove` | Points ansa's bot at core's webhook, or takes it off |

Development tools (refused in production and outside a local database;
`CORE=<address>` for a local core other than CORE_LISTEN_ADDR's):
| make | Does |
|---|---|
| `simulate-message OWNER= NAME= TEXT=` (or `simulate`) | A stand-in chat customer's message |
| `simulate-telegram OWNER= NAME= TEXT=` | A message to the stand-in Telegram account |
| `simulate-messenger OWNER= NAME= TEXT=` | A message to the stand-in Facebook Page |
| `telegram-poll` | Reads a real development bot's updates without a public address |
| `simulate-vapi-call NUMBER= [VARIANT=all]` | Made-up calls (and bad requests) to the running core |
| `simulate-vapi-tool-call NUMBER= QUESTION= [CALL=] [END_CALL=1]` | The live assistant's knowledge search |
| `simulate-solved-call OWNER= NUMBER=` | A call the AI marked solved (a stand-in for the brain) |
| `try-brain OWNER= CALL=` | The brain's verdict on a stored call, saved nowhere |
| `simulate-inbound-email TO= [VARIANT=]` | A made-up customer email through the forwarding address |
| `simulate-email-bounce FILE= [KIND=]` | A delivery problem for an email in `.dev-emails/` |
| `simulate-post-metrics JOB= NUMBERS=` | Simulated numbers for a stand-in's post |
| `seed-tickets OWNER=` | Sample requests |

Not needed any more: `pnpm assistant:catch-up` (core's scheduler runs the
catch-up every 15 seconds).

## Folders
| Folder | What | Docs |
|---|---|---|
| `cmd/core/` | Starts the service | this page |
| `cmd/operator/` | ansa's operator commands | [commands](../docs/backend/modules/commands.md) |
| `cmd/simulate/` | The development tools (stand-in messages, made-up calls and emails, telegram-poll, try-brain, sample requests, simulated numbers) | [commands](../docs/backend/modules/commands.md), [analytics](../docs/backend/modules/analytics.md) |
| `internal/commands/` | What the commands share: the company of an owner's address, `--yes`, the development guard, their statements | [commands](../docs/backend/modules/commands.md) |
| `internal/config/` | Settings, checked at start | [config](../docs/backend/modules/config.md) |
| `internal/logging/` | Safe JSON logs | [logging](../docs/backend/modules/logging.md) |
| `internal/secure/` | Encryption of stored text | [secure](../docs/backend/modules/secure.md) |
| `internal/tenant/` | The company id type | [tenant](../docs/backend/modules/tenant.md) |
| `internal/httpserver/` | Server, headers, size caps, /health | [httpserver](../docs/backend/modules/httpserver.md) |
| `internal/brainclient/` | Signed requests to the brain | [brainclient](../docs/backend/modules/brainclient.md) |
| `internal/database/` | PostgreSQL pool, transactions, tenant check | [database](../docs/backend/modules/database.md) |
| `internal/ratelimit/` | Attempt counters (kept in PostgreSQL) | [ratelimit](../docs/backend/modules/ratelimit.md) |
| `internal/jobs/` | The job queue and its worker | [jobs](../docs/backend/modules/jobs.md) |
| `internal/conversations/` | Contacts, conversations, messages | [conversations](../docs/backend/modules/conversations.md) |
| `internal/telegram/` | The Telegram Business channel | [telegram](../docs/backend/modules/telegram.md) |
| `internal/chat/` | The one door for sending to customers | [chat](../docs/backend/modules/chat.md) |
| `internal/messenger/` | The Facebook Messenger channel | [messenger](../docs/backend/modules/messenger.md) |
| `internal/social/` | The only place a social account's token is decrypted; renewing tokens before a platform call; revoking | [social](../docs/backend/modules/social.md) |
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
| `internal/devices/` | The ansa phone app: pairing by a QR code, its token, check-ins, its main screen, and the watcher that switches ansa away when no owner's phone was reachable | [devices](../docs/backend/modules/devices.md) |
| `internal/setup/` | /welcome and Settings → What it knows | [setup](../docs/backend/modules/setup.md) |
| `internal/channels/` | Settings → Connections | [channels](../docs/backend/modules/channels.md) |
| `internal/publishing/`, `internal/drafts/`, `internal/contentrules/` | The publishing queue (Facebook text posts); content drafts; what a post may say | [publishing](../docs/backend/modules/publishing.md), [contentrules](../docs/backend/modules/contentrules.md) |
| `internal/autopost/` | "Post for me": the topic brain, posting times, writing, ansa's checks, the switch | [autopost](../docs/backend/modules/autopost.md) |
| `internal/files/` | Private file storage: the development folder or R2 (signed requests and links) | [files](../docs/backend/modules/files.md) |
| `internal/documents/`, `internal/supportsetup/` | Phone, email and documents: uploads, downloads, reply-to and support addresses | [documents](../docs/backend/modules/documents.md) |
| `internal/billing/` | Billing: Stripe's checkout and portal, its signed webhook, the page | [billing](../docs/backend/modules/billing.md) |
| `internal/accounts/` | Signup, invites joined, confirming, login with fair limits, resets, one's own account | [accounts](../docs/backend/modules/accounts.md) |
| `internal/teammates/` | The Team page: invites, roles, removing someone, categories | [teammates](../docs/backend/modules/teammates.md) |
| `internal/maintenance/` | Hourly cleanup of rows nobody can use any more | [maintenance](../docs/backend/modules/maintenance.md) |
| `internal/knowledge/` | The knowledge base: articles, approvals, search, the AI's slice, imports | [knowledge](../docs/backend/modules/knowledge.md) |
| `internal/safefetch/` | Fetching a typed web address without reaching anything private | [safefetch](../docs/backend/modules/safefetch.md) |
| `internal/postmetrics/` | Reading published posts' numbers (Facebook) | [postmetrics](../docs/backend/modules/postmetrics.md) |
| `internal/analytics/` | The Analytics page, what each number means, Review performance (every cited number checked), simulated numbers | [analytics](../docs/backend/modules/analytics.md) |
| `internal/socialconnect/` | Connecting and disconnecting social accounts (Facebook Pages, LinkedIn, X, YouTube); the Accounts page | [socialconnect](../docs/backend/modules/socialconnect.md) |
| `internal/platforms/` | LinkedIn, X and YouTube: signing in, renewing, revoking, posting, numbers, the stand-in | [platforms](../docs/backend/modules/platforms.md) |
| `internal/calls/`, `internal/download/` | Phone calls: Vapi's webhook, the live knowledge search, the AI's decision, the Calls page; downloads from allowed hosts | [calls](../docs/backend/modules/calls.md) |
| `internal/phone/` | Calls answered live (step 55): the one door every phone line uses (start, turn, end), the practice phone in development | [phone](../docs/backend/modules/phone.md) |
| `internal/studio/` | The content studio: drafts written, edited, approved, rejected, archived; the AI's drafts | [studio](../docs/backend/modules/studio.md) |
| `internal/media/`, `internal/mediagen/` | The media library: uploads, alt text, deleting, attaching; making images (the one door, the stand-in) | [media](../docs/backend/modules/media.md), [mediagen](../docs/backend/modules/mediagen.md) |
| `internal/menu/`, `internal/menureading/` | The menu: dishes, prices, availability; Read my menu | [menu](../docs/backend/modules/menu.md) |
| `internal/profile/`, `internal/strategy/`, `internal/calendar/`, `internal/cofounder/` | The Co-Founder: business profile and interview, marketing plans, the calendar and "Plan the next 2 weeks", the Overview | [profile](../docs/backend/modules/profile.md), [strategy](../docs/backend/modules/strategy.md), [calendar](../docs/backend/modules/calendar.md), [cofounder](../docs/backend/modules/cofounder.md) |
