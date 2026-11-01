# commands (core/cmd/operator, core/cmd/simulate, core/internal/commands)

**What:** ansa's command-line tools, moved from the old `scripts/*.ts` (run
with `pnpm`). Two programs, both run from `core/`:
- `go run ./cmd/operator <command>`: **ansa's operator**, in development
  and against production (linking phone lines, forwarding addresses, the
  Telegram webhook).
- `go run ./cmd/simulate <tool>`: **development tools** (made-up customers,
  calls, emails and numbers, to try core before the real services exist).

Each has a `make` target named like the old `pnpm` script (`pnpm
link:phone-line` is `make link-phone-line`), listed in `core/Makefile` with
an example.

**Settings:** the environment first, then `../.env.core` for what the
environment doesn't set (`config.FillFromFile`: `NAME=value` lines, `#`
comments, a value may sit in quotes). A setting given on the command line
always wins, as with the old `tsx --env-file`: `DATABASE_URL="<direct url>"
make link-phone-line ...` reaches that database, never the file's local one.
Then the same checks as core's own start (`config.Load`).

## Rules every command keeps (`core/internal/commands`)
- **A company is found ONLY by the address of a confirmed, active OWNER**
  (`FindOwnersCompany`, trimmed and lower-cased). A member, someone who
  never confirmed (an invite an owner sent to someone else's address, or a
  typo, makes an account in the inviter's company) or a removed owner finds
  nothing: "That address is not the confirmed address of an owner (not
  removed) of any company. Nothing was changed." A company id is never typed
  in. This read across companies is listed in `CROSS_COMPANY.md`.
- The command prints the company before it acts: `Company: "<name>"
  (company id <id>)` (the id tells two companies of the same name apart:
  every new one is "New business" until its setup's first step).
- **A command that changes something changes nothing without `--yes`**
  (anywhere among the arguments; `YES=1` with make): it says "Nothing was
  changed. If this is the right company, run the same command again with
  --yes to ..." and exits with 1, so a script calling it doesn't carry on
  as if it had.
- **Output** names the company and what changed: never a token, a secret, a
  customer's address or name, or a message. A forwarding address is the
  company's own (shown on its Connections page; not secret: it is the
  Reply-To of its "solved" emails), printed by the commands about it.
- Every statement lives in `core/internal/commands` (or the module whose
  code a tool calls) and names the company, except the two listed reads
  across companies; the tenant check (`tenant_test.go`) reads `core/cmd` too.
- **Development tools** are refused before anything is read or sent when
  ANSA_ENV is `production` or DATABASE_URL isn't on this computer
  (`localhost`, `127.0.0.1`, `::1`): they write made-up rows (`ReasonNotToRun`).
  The ones that send webhooks send them only to a core on this computer:
  `--core <address>` (`CORE=` with make), `http(s)://localhost|127.0.0.1|[::1]:<port>`,
  by default the running core's own CORE_LISTEN_ADDR (`CoreAddress`).

## Operator commands (`go run ./cmd/operator ...`)
| Command | What it changes | Its own guards |
|---|---|---|
| `link-phone-line <owner email> <vapi phone number id> [--yes]` | Links one of ansa's Vapi numbers to the owner's company: a `phone_lines` row. Its calls are then saved for that company. | Vapi's id: 3-100 letters, digits, `_` or `-`. "Already linked to this company." (exit 0); a number of another company is refused, never naming it. A number linked by someone else in the same instant links nothing. |
| `unlink-phone-line <owner email> <vapi phone number id> [--yes]` | Deletes the company's line (the undo of a wrong link). | Only the company's own number; a number that has calls stays (its calls point at it: Postgres refuses). |
| `show-forwarding-address <owner email>` | Nothing: prints the company's forwarding address, `c-<token>@<INBOUND_EMAIL_DOMAIN>`. | Refused without INBOUND_EMAIL_DOMAIN (the development domain receives nothing: the address would look right and get nothing). |
| `replace-forwarding-address <owner email> [--yes]` | Gives the company a new token, the database's own default (nobody picks it), and prints the new address. The old address stops at once: the company forwards to the new one (Gmail asks to confirm again), and replies to emails sent before no longer arrive. | As above. |
| `telegram-webhook set <core's public https address>` / `telegram-webhook remove` | Telegram's side only: `setWebhook` to `<address>/webhooks/telegram` with TELEGRAM_WEBHOOK_SECRET as `secret_token`, the four kinds of updates ansa reads and 40 connections; or `deleteWebhook` (a development bot read by `telegram-poll`). | Needs all three TELEGRAM_ settings; https only (Telegram's rule), no query; prints the outcome by HTTP status only, never the token or Telegram's own words. No `--yes` (as the old script). |

## Development tools (`go run ./cmd/simulate ...`)
"Over HTTP" tools post to a **running core** (as the old scripts posted to
the running app), signed with core's own signing code and the settings the
running core reads. "In this process" tools hand a made-up request straight
to core's own webhook handler in the command's process (as the old scripts
called the code the webhook calls), signed with a secret made for that one
run, so no core needs to be running; a running core then answers the
customer (the assistant's reply is a job).

| Tool | How | What it writes or sends |
|---|---|---|
| `message <owner email> "<name>" "<text>"` | in this process | A stand-in chat customer's message (the contact is the name), encrypted, and the assistant's reply job. |
| `telegram <owner email> "<name>" "<text>"` | in this process: core's Telegram webhook handler | A Telegram update as Telegram sends one, to the company's development stand-in Telegram account (connect it on Settings → Connections first). The same name is the same customer (a number from the name's hash, as the old script made it). |
| `messenger <owner email> "<name>" "<text>"` | in this process: the functions core's Messenger webhook saves with | A message to the company's development stand-in Facebook Page, its customer `dev:stand-in:<name>`. Not through the webhook: the stand-in Page's id isn't one Meta signs, and development has no Meta app secret. |
| `telegram-poll` | in this process: core's Telegram webhook handler | A REAL development bot's updates, read with `getUpdates` (25-second long polls) and each handed to the handler exactly as the webhook would receive it (TELEGRAM_WEBHOOK_SECRET, the same limits and saving). An update not saved (500, 429) is read again after a wait; the next read starts after the last update. Needs the three TELEGRAM_ settings; stops with a message while the bot has a webhook (`make telegram-webhook ACTION=remove`). Prints each update's kind only. Ctrl+C stops it. |
| `vapi-call <vapi number id> [valid\|duplicate\|unsigned\|bad-signature\|stale\|too-large\|unknown-line\|other-event\|all] [--core <address>]` | over HTTP, signed with `calls.SigningFrom` (the VAPI_* settings) | A made-up end-of-call report (with a recording on a host core never copies from, and an organization and company id in the payload core ignores), or a bad request; prints each variant's status against the one expected. The running core needs the same VAPI_WEBHOOK_SECRET. |
| `vapi-tool-call <vapi number id> "<question>" [--call <vapi call id>] [--end-call] [--core <address>]` | over HTTP, as above | The live assistant's `search_company_knowledge` call; prints the answer it would get (the company's own approved articles). `--call` asks during an earlier call; `--end-call` then sends that call's end-of-call report. |
| `solved-call <owner email> <vapi number id>` | in this process: core's Vapi webhook handler, then core's call analysis | A call the AI marked "solved", decided by a stand-in for the brain quoting the customer's closing sentence (to try "Escalate to a ticket" without the AI). The brain's own check of that sentence doesn't run (the brain is Python). A running core may decide the call first with its own brain: the tool then says so. The number must be the company's. |
| `try-brain <owner email> <call id>` | core's call analysis, to the brain at BRAIN_URL | Nothing: a dry run (the call isn't claimed). The same request and checks as the analysis; with ANTHROPIC_API_KEY in the brain's settings ONE paid model call, without it "model_unavailable" for free. Prints the outcome, who decided, the reason, the category and the model: never the transcript or the AI's own words. |
| `inbound-email <owner email or forwarding address> [valid\|unauthenticated\|cc\|typed-only\|auto-reply\|newsletter\|html-only\|contact-form\|odd-sender\|thread-reply\|unsigned] [--core <address>]` | over HTTP, signed with `resend.Sign` (Standard Webhooks) and RESEND_WEBHOOK_SECRET | The email's content in `<ANSA_DEV_FOLDER>/.dev-inbound/<id>.json` (core's stand-in for Resend's Receiving API) and a signed `email.received` event addressed per variant. Refused while SEND_REAL_EMAIL is "true" (core would ask Resend instead). |
| `email-bounce <file in .dev-emails/> [bounced\|complained\|suppressed\|failed] [--core <address>]` | over HTTP, as above | A signed delivery problem for the sent email whose id is `dev-outbox:<file>`. The file must be in `.dev-emails/`. |
| `post-metrics <publish job id> views=120 ...` | in this process | Simulated numbers for a stand-in's published post ([analytics](analytics.md)). |
| `seed-tickets <owner email>` | in this process: core's "New request" path | Eight sample requests typed in by that owner (channel "manual"): numbered, their history, routed, their assignees emailed. Running it again adds another batch. |

## Not ported
- `pnpm assistant:catch-up`: core's scheduler runs the assistant's catch-up
  every 15 seconds and "Post for me" every minute (`scheduledTasks`,
  `cmd/core/wiring.go`): a running core is the catch-up.
- `pnpm check:tenant-isolation` (`scripts/tenant-isolation/`): the old
  backend's checks; core's Go tests (`make check`) and the brain's pytest
  take over their rules module by module.
- `scripts/company-of-user.ts` and `scripts/vapi-sample.ts` were helpers:
  `core/internal/commands` and `cmd/simulate/vapisample.go`.

## Differences from the old scripts
- `solved-call` and `try-brain` take the owner's address too, and
  `seed-tickets` an OWNER's (the old one took any account's): a company is
  never found by a call id, a number or any account but a confirmed owner's.
- `seed-tickets` makes typed-in requests (channel "manual") through core's
  own path, as that owner; the old samples said "phone" or "email".
- `telegram-webhook set` takes core's public https address: core serves
  `/webhooks/telegram` (the old one used the screens' BETTER_AUTH_URL with
  `/api/webhooks/telegram`).
- The assistant's replies to simulated messages come from a running core's
  jobs, not from the command.
- `try-brain` prints what the brain decided; the slice's size and the token
  counts stay inside the brain.
- Nothing prints a customer's name or text (the old ones printed the name).

**Tests:** `core/internal/commands` (live database): only a confirmed,
active owner's address finds a company; `--yes` anywhere; the development
guard and the core address; phone lines linked once, unlinked only before
their first call; a new forwarding token. `core/internal/config/file_test.go`:
the file never overrides the environment; a bad line sets nothing.
`core/cmd/operator` (live database): the usage before any setting; link
and unlink only with `--yes`, for an owner's company, a number of another
company refused, one with calls kept; the forwarding address shown and
replaced only with its domain and `--yes`; `telegram-webhook` against a fake
Telegram (the address, the secret, the four updates; refusals by status;
never the token in the output). `core/cmd/simulate` (live database): every
tool refused in production and against a database elsewhere; the usage
first; the stand-in chat, Telegram and Messenger messages saved with their
reply job (Telegram through the webhook's code, one customer per name);
`telegram-poll` against a fake Telegram (each update through the webhook's
code, the offsets, a duplicate saved once, a webhook stops it); every
`vapi-call` variant against core's real webhook; `vapi-tool-call` (two
lookups in one call, then the call); `solved-call` (solved, the sentence
encrypted, no request); `try-brain` (a dry run, only the owner's company's
calls); `inbound-email` (only the forwarding address decides; ignored and
unsigned variants save nothing; refused with real email on);
`email-bounce` (the problem on the sent email). The Telegram tests refuse to
run while TELEGRAM_BOT_TOKEN is set (as the old checks did): they answer for
Telegram with a fake and never reach a real bot. `core/internal/telegram/botapi_test.go`,
`core/internal/calls/try_test.go`.
