# Migration plan: old TypeScript backend → core (Go) + brain (Python)

## How we move (no big bang)
- The database and its tables stay the same; core reads and writes them
  exactly as the old code does (same columns, same encryption format).
- One module at a time: core takes over its webhooks, jobs and API; the
  screens switch to core's API for that module; the old TypeScript for it is
  deleted only after core's tests prove the same behaviour.
- The old automated checks (`scripts/tenant-isolation/`) are the
  specification: every rule they prove is proved again by a core or brain test.
- This page is updated at every step. Status: ⬜ not started · 🔨 in progress · ✅ done.

## Phase 0: foundation
| Module | Where | What | Status |
|---|---|---|---|
| Docs | docs/backend/ | Architecture, security, conventions, this plan | ✅ |
| config | core/internal/config | Settings from the environment, checked at start | ✅ |
| logging | core/internal/logging | Safe JSON logs, allowed fields only | ✅ |
| secure | core/internal/secure | AES-256-GCM `v1:` encryption, compatible with old data | ✅ |
| httpserver | core/internal/httpserver | Server with time limits, security headers, size caps, /health | ✅ |
| brainclient | core/internal/brainclient | Signed requests from core to brain | ✅ |
| brain service | brain/ | FastAPI app, signature check, /health | ✅ |
| tenant | core/internal/tenant | The CompanyID type every query takes | ✅ |
| database | core/internal/database | Connection pool, transactions, the company-in-every-query test | ✅ |
| ratelimit | core/internal/ratelimit | Counters in PostgreSQL, HMAC keys shared with the old backend | ✅ |
| jobs | core/internal/jobs | Job queue in PostgreSQL (`SKIP LOCKED`), retries, hand-back (table `core_jobs`, migration 0048) | ✅ |

## Phase 1: chats
| Module | Old code | Status |
|---|---|---|
| conversations, contacts, messages | db/conversation*.ts, services/conversations.ts | 🔨 saving messages done |
| chat delivery (one door) | lib/chat-delivery.ts | ✅ Telegram + stand-in (Messenger with its module) |
| Telegram (webhook, link codes, connect) | services/telegram-*.ts, adapters/telegram.ts | 🔨 webhook, messages, deletions, sending done; link codes next |
| Messenger | services/messenger-*.ts, adapters/messenger.ts | ⬜ |
| development stand-ins | adapters/dev-chat-outbox.ts, scripts/simulate-*.ts | ⬜ |

## Phase 2: the assistant
| Module | Old code | Status |
|---|---|---|
| when ansa answers (gate, away, catch-up) | db/assistant-runs.ts, lib/assistant/availability.ts | ✅ gate.go, availability.go, catchup.go (run every 15 s by core's scheduler) |
| reply thinking (brain) | lib/assistant/prompt.ts, answer.ts | ✅ brain/brain/assistant |
| reply checks (core) | lib/assistant/reply-checks.ts | ✅ core/internal/assistant/checks.go |
| the reply run (job `assistant.reply`) | services/assistant-reply.ts | ✅ core/internal/assistant/reply.go, send.go |
| handover, holding reply, owner alerts | services/assistant-handover.ts, owner-alerts.ts | ✅ handover.go, core/internal/alerts |
| "a ticket is yours" email | services/assignment-notifications.ts | ✅ core/internal/assignments |
| email out (the one door) | lib/send-email.ts, adapters/resend.ts, dev-email-outbox.ts | ✅ core/internal/email (customer "solved" emails with phase 5) |
| AI engine (own key, ansa's, Claude Code in development) | services/assistant-engine.ts, adapters/claude-code.ts | ✅ core sends it; brain/brain/claude_code.py |
| Ask me first drafts (send, edit, discard), test box | services/assistant-drafts.ts, -test.ts | 🔨 drafts are saved; the person's actions move with the screens' API |

## Phase 3: menu and orders
| Module | Old code | Status |
|---|---|---|
| menu, "Not available today" | db/menu.ts | ⬜ |
| menu reading (brain) | lib/menu-reading/ | ⬜ |
| orders and status messages | lib/orders.ts, order-steps.ts, db/order*.ts | ⬜ |

## Phase 4: posting and marketing
| Module | Old code | Status |
|---|---|---|
| Post for me (topic brain, writer, checks) | lib/autopost/, services/autopost*.ts | ⬜ |
| content drafts, media library | db/content-draft*.ts, services/media-*.ts | ⬜ |
| social connections (OAuth per platform) | adapters/linkedin, facebook, x, youtube | ⬜ |
| publishing queue, post numbers, analytics | services/publish-*.ts, post-metrics*.ts | ⬜ |
| knowledge base and search | db/knowledge*.ts, lib/knowledge/ | ⬜ |
| business profile, plans, calendar, reviews | services/marketing-*.ts, calendar-*.ts, performance-*.ts | ⬜ |

## Phase 5: support (tickets, calls, email)
| Module | Old code | Status |
|---|---|---|
| tickets, routing, categories, notes, history | db/ticket*.ts, db/routing.ts | ⬜ |
| calls (Vapi webhook, call brain, recordings) | services/vapi-*.ts, lib/call-brain/ | ⬜ |
| email in (Resend webhook, filters, triage) | services/inbound-email-*.ts, lib/email-triage/ | ⬜ |
| email out (outbox, solved emails) | services/customer-emails.ts, lib/send-email.ts | ⬜ |

## Phase 6: accounts and money
| Module | Old code | Status |
|---|---|---|
| sign up, login, email confirm, reset, sessions | services/auth.ts, signup.ts, password-reset.ts (Better Auth) | ⬜ |
| team, invites, roles | db/team-members.ts, invites.ts | ⬜ |
| setup and settings | services/restaurant-setup.ts, assistant-settings.ts | ⬜ |
| billing (Stripe) | services/billing.ts, stripe-webhook.ts | ⬜ |
| cleanup, health, monitoring | services/maintenance.ts, health.ts | ⬜ |

## Phase 7: screens on core's API
Every page and action in `app/` calls core instead of `services/`. Then
`services/`, `db/` (TypeScript) and `adapters/` are deleted.

## Phase 8: switch-over
Deploy core and brain, point the webhooks at core, watch, then remove the old
backend for good.
