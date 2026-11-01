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
| conversations, contacts, messages | db/conversation*.ts, services/conversations.ts | ✅ saving (conversations), the Inbox, the page, take over, hand back, replies, important (inbox) |
| chat delivery (one door) | lib/chat-delivery.ts | ✅ Telegram, Messenger and the stand-in |
| Telegram (webhook, link codes, connect) | services/telegram-*.ts, adapters/telegram.ts | ✅ telegram, channels (the operator's `telegram:webhook` script remains) |
| Messenger | services/messenger-*.ts, adapters/messenger.ts | ✅ core/internal/messenger, social (switching a Page's messages on moves with the social connect flow) |
| development stand-ins | adapters/dev-chat-outbox.ts, scripts/simulate-*.ts | 🔨 the stand-in chat and `cmd/simulate message` done; Telegram and Messenger stand-in simulators next |

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
| Ask me first drafts (send, edit, discard), test box | services/assistant-drafts.ts, -test.ts | ✅ inbox (drafts), assistant/try.go (the test box) |

## Phase 3: menu and orders
| Module | Old code | Status |
|---|---|---|
| menu, "Not available today" | db/menu.ts | ✅ core/internal/menu (in core's API) |
| menu reading (brain) | lib/menu-reading/, services/menu-reading.ts | ✅ core/internal/menureading, brain/brain/menu (PDFs go to the model as themselves) |
| orders: pricing, summary, placing, taking back, new-order alerts | lib/orders.ts, order-steps.ts, db/order-proposals.ts, services/assistant-order.ts, order-alerts.ts | ✅ core/internal/orders, assistant/order.go, alerts/orders.go |
| the Orders page's status changes and messages | services/orders.ts, db/order-status.ts | ✅ core/internal/orders (in core's API) |

## Phase 4: posting and marketing
| Module | Old code | Status |
|---|---|---|
| Post for me (topic brain, writer, checks, switch, page) | lib/autopost/, services/autopost*.ts | ✅ core/internal/autopost, brain/brain/posts |
| content drafts (create, read, claims check) | db/content-draft*.ts | ✅ core/internal/drafts |
| content studio edits and approvals, media library | db/content-draft*.ts, services/content-*.ts, services/media-*.ts | ✅ core/internal/studio, media, mediagen (the development stand-in only: no real image service is chosen); brain/brain/content |
| social connections: Facebook Pages (connect, return, stand-in, disconnect) | services/social-connect.ts, social-oauth-callback.ts, adapters/facebook.ts | ✅ core/internal/socialconnect |
| social connections: LinkedIn, X, YouTube (OAuth, PKCE, renewals, revokes), the Accounts page | adapters/linkedin, x, youtube, services/social-tokens.ts, social-accounts.ts | ✅ core/internal/socialconnect, social (Renewer.Prepare, RevokeRemoved), platforms (not tried against the real platforms: no app yet) |
| LinkedIn, X, YouTube connectors: posting (text, one image, YouTube videos), X's and YouTube's numbers, the stand-in, metric definitions | adapters/linkedin*, x*, youtube*, dev-social.ts, lib/metric-definitions.ts | ✅ core/internal/platforms (wired into the publishing queue and the numbers collector: cmd/core/senders.go, postmetrics/others.go) |
| publishing queue: the checks of every platform and format, Facebook text and image posts, the queue page, a draft's Publish section, scheduling, Cancel / Publish now / Retry / Mark, auto-publish rules (in core's API) | services/publish-*.ts, publishing-pages.ts, draft-publishing.ts, autopublish-rules.ts, db/publish-*.ts, db/autopublish-rules.ts, adapters/facebook-posts.ts | ✅ core/internal/publishing (LinkedIn, X, YouTube plug in at senderFor) |
| post numbers: Facebook (reactions, comments, shares) | services/post-metrics-collection.ts, adapters/facebook-metrics.ts | ✅ core/internal/postmetrics |
| the Analytics page, what each number means, Review performance, simulated numbers | services/analytics-page.ts, performance-review.ts, post-metrics-simulation.ts, lib/analytics/, lib/performance-review/, lib/metric-definitions.ts | ✅ core/internal/analytics (in core's API), brain/brain/analytics, `cmd/simulate post-metrics` (the planner's reading of the newest review moves with the plans) |
| publishing images, videos, LinkedIn, X, YouTube; their numbers; analytics and reviews | services/publish-*.ts, post-metrics*.ts, performance-*.ts | ⬜ |
| knowledge search and the AI's article slice (the assistant reads them) | db/knowledge-search.ts, lib/knowledge/search-query.ts, prompt-slice.ts | ✅ core/internal/knowledge |
| knowledge base: writing, approving, imports (documents incl. PDF via the brain, web pages via safefetch), the Knowledge page | db/knowledge*.ts, lib/knowledge/, lib/safe-fetch.ts | ✅ core/internal/knowledge, safefetch; brain/brain/documents |
| business profile, interview, fact suggestions, marketing plans and the Strategy page, the calendar and "Plan the next 2 weeks", the Overview | services/business-profile.ts, onboarding-*.ts, fact-suggestions.ts, marketing-*.ts, calendar-planning.ts, cofounder-overview.ts | ✅ core/internal/profile, strategy, calendar, cofounder; brain/brain/cofounder (in core's API; the screens still call the old services) |
| performance reviews | services/performance-*.ts | ⬜ |

## Phase 5: support (tickets, calls, email)
| Module | Old code | Status |
|---|---|---|
| tickets, routing, categories, notes, history | db/ticket*.ts, db/routing.ts | ✅ every person's action on requests, typed-in requests, same-customer routing (in core's API) |
| calls (Vapi webhook, the live knowledge search, call brain, recordings, the Calls page, escalation) | services/vapi-*.ts, call-*.ts, lib/call-brain/ | ✅ core/internal/calls, core/internal/download; brain/brain/calls (not tried against a real Vapi account) |
| email in (Resend webhook, filters, triage) | services/inbound-email-*.ts, lib/email-triage/ | ✅ core/internal/resend, inbound; brain/brain/email (core's jobs retry an email by themselves; "Process again" on the Emails page) |
| email out (outbox, solved emails) | services/customer-emails.ts, lib/send-email.ts | ✅ core/internal/outbox (now retried on its own within minutes) |

## Phase 6: accounts and money
| Module | Old code | Status |
|---|---|---|
| sign up, joining through an invite, login, email confirm, reset, account, sessions (Better Auth's formats kept) | services/auth.ts, signup.ts, password-reset.ts, account.ts (Better Auth) | ✅ core/internal/accounts |
| team, invites, roles, removing, categories | db/team-members.ts, invites.ts, categories.ts, user-categories.ts | ✅ core/internal/teammates (joining: core/internal/accounts) |
| setup and settings | services/restaurant-setup.ts, assistant-settings.ts | ✅ core/internal/setup, settings (in core's API) |
| Phone, email and documents (the old /setup): reply-to, support addresses, documents | services/setup.ts, documents.ts | ✅ core/internal/supportsetup, documents |
| private file storage (development folder, R2 with signed links) | lib/file-storage.ts, adapters/r2.ts | ✅ core/internal/files |
| billing (Stripe: checkout, portal, signed webhook, the page, the dev stand-in) | services/billing.ts, stripe-webhook.ts | ✅ core/internal/billing (enforcing nothing yet: step 56, the owner decides) |
| cleanup, health | services/maintenance.ts, health.ts | ✅ core/internal/maintenance (hourly), GET /health |
| monitoring and alerts (a log service, an uptime monitor) | docs/going-live.md | ⬜ a choice for the owner |

## Phase 7: screens on core's API
Every page and action in `app/` calls core instead of `services/`. Then
`services/`, `db/` (TypeScript) and `adapters/` are deleted.
| Module | Status |
|---|---|
| core reads Better Auth's session itself (`core/internal/session`) | ✅ |
| the API's frame: the screens' signature, the session, JSON (`core/internal/api`) | ✅ |
| Orders page: list and status changes | ✅ in core's API; the page switches with the others |
| Inbox: list, conversation page, take over, hand back, reply, drafts, important, what ansa did | ✅ in core's API |
| Home: status card and its switches, while you were away, getting started, needs you | ✅ in core's API (business numbers with their modules) |
| Settings → Assistant: texts, reply mode, alerts, AI engine and own key, away hours; Try your assistant | ✅ in core's API |
| /welcome and Settings → What it knows: every setup section, finish | ✅ in core's API |
| Menu: dishes, order, availability, "Looks right" | ✅ in core's API |
| Connections: Telegram link, stand-in, disconnect; Pages, forwarding address, phone lines | ✅ in core's API |
| All requests, a request's page, every action, solving with the email, New request | ✅ in core's API |
| Emails page: the list, Process again, Make a ticket anyway | ✅ in core's API |
| the screens' side: one helper that signs and calls core (`lib/core-api.ts`), one view file per area (`lib/core-views/`) | ✅ behind the switch: CORE_API_URL and SCREENS_SHARED_SECRET set = every switched page and action calls core; unset = the old services, unchanged |
| Calls page: list, a call, Analyze now, Escalate, the recording | ✅ in core's API |
| Screens switched (869cd05, 2f7e6f1): logins, account, billing; Home, Settings, setup, Post for me; Inbox, requests, Emails; menu, Connections, Team, knowledge, the old Setup page; the Calls page | ✅ |
| The marketing pages (Overview, Interview, Profile, Strategy and its versions, Calendar, Content studio, a draft's page and Publish section, Media library, Queue, Accounts, Analytics) and LinkedIn, X, YouTube (5a6bf72, b92e055, a7ce1a9) | ✅ moved to core (the owner chose to keep them, 2026-11-01) and their screens switched |

## Phase 8: switch-over
Deploy core and brain, point the webhooks at core, watch, then remove the old
backend for good.
