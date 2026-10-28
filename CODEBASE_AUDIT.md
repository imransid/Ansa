# Codebase audit: ansa

Date: 2026-10-26. Branch: `audit-fixes`. Baseline taken before any change.

Written for the product owner and for engineers new to this codebase.
What gets fixed and built next is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
The rules and the long list of known gaps are in [CLAUDE.md](CLAUDE.md); this
report points to them instead of repeating them.

## 1. Summary

**What the app is today.** ansa is AI first-line support for companies: one
Next.js 16 app with Postgres (Drizzle) and Better Auth. Customers phone a
company's number (Vapi) or email its forwarding address (Resend). After each
call or email, Claude decides: solved, or needs a person. If a person is needed,
a ticket goes to the expert for its category or to whoever already handles
that customer. Solved tickets email the customer. Around that: team and roles,
Setup, document uploads, Stripe billing, an Emails page, a public website.
21 pages, 7 API routes, a local stand-in for every outside service.

**Baseline (2026-10-26, before any change).**

| Step | Command | Result |
|---|---|---|
| Migrations | `pnpm db:migrate` | Applied, exit 0 |
| Types | `pnpm typecheck` (`tsc --noEmit`) | 0 errors |
| Lint | `pnpm lint` (`eslint`) | 0 problems |
| Checks | `pnpm check:tenant-isolation` | **450 PASS, 0 FAIL** ("All tenant isolation checks passed") |
| Build | `pnpm build` (Next.js 16.4.2, Turbopack) | Success. 33 static pages generated, every `/api` route dynamic (ƒ). 2 warnings, both from `lib/production-warnings.ts:91` (section 4.2) |

**Headline.**

- **The support product (Module A) is complete as far as it can go without
  outside accounts.** Of 124 capabilities reviewed: 92 WORKING, 8 PARTIAL,
  5 UNVERIFIED, 7 BLOCKED, 12 MISSING, 0 BROKEN.
- **Its biggest gap is knowledge.** The AI never reads the company's documents
  or past tickets, and ansa does not feed the live call (one hand-made Vapi
  assistant talks to every caller). "Solved" means the customer said so, not
  that the answer was checked against anything.
- **The AI Co-Founder (Module B) does not exist yet:** no table, page, service
  or prompt. Many existing pieces can be reused (section 6).
- **Blocked on outside accounts:** Vapi, Resend (send and receive), R2, Stripe,
  an Anthropic key, hosting, four social platforms, and an image/video provider
  not yet chosen.
- **13 defects.** None lets a user reach another company's data through the app
  (one, F4, lets ansa's operator link a number to the wrong company). Two are
  medium (a possible double Stripe charge, verified; Vapi header defaults that
  don't match Vapi's), eleven low. Stage 1 (F1-F12) fixes twelve; one stays a
  known gap.
- **Process risk:** no git remote, about 45,000 changed lines never committed,
  CI never run. This disk is the only copy.

## 2. How it was checked

- **Five subsystem reviews** read the code (calls; email; tickets and team;
  auth and security; files, setup, billing, ops, UI). Each gave capabilities
  with status and evidence, suspected bugs, gaps, and where new work plugs in.
- **One adversarial pass** tried to disprove the suspected bugs. Its one verdict:
  the Stripe double checkout (F1) is real, medium. For every other defect this
  report re-read the cited code: the cause is there, but no check reproduces it.
- **A baseline run** (migrate, typecheck, lint, checks, build) before any change;
  PASS and FAIL lines counted in the check log.
- **Official-doc research** (2026-10-26) on Vapi tools, social APIs, image and
  video APIs and Anthropic: [docs/research/](docs/research/).
- This report ran nothing new, did not touch the database, and opened no browser.

**What the statuses mean.**

| Status | Meaning here |
|---|---|
| WORKING | A check in `scripts/tenant-isolation/` exercises it and passes, and the code matches. A file existing proves nothing. |
| PARTIAL | Part of it is proven by a check. Part is missing, untested, or limited by a known defect. |
| BROKEN | Fails a check or fails on its main path. None found. |
| MISSING | Not built. |
| BLOCKED | Built and proven with a stand-in or a fake. The real service needs an account ansa does not have. |
| UNVERIFIED | The code exists, but no check or render test exercises it. |

The check suite (87 files of checks and helpers) runs against the local Postgres
in Docker with fake models and stand-ins, and refuses to run with real email,
R2, Stripe or a non-local database (`hygiene-checks.ts`). So WORKING means
"works locally against fakes"; real provider behaviour is BLOCKED.

**Re-grades.** Three items the reviews called WORKING have no check: security
headers (now PARTIAL: only the missing X-Powered-By is checked), the header at
phone width and the confirm-before-delete buttons (now UNVERIFIED). The counts
include this. The tables merge rows that two reviews both covered.

**New to the code?** Read CLAUDE.md (rules, then Known gaps). Requests go page
or route -> `services/` -> `db/`; only `db/` queries, always by `company_id`.
The checks are the best description of each feature; `docs/going-live.md` says
what to do on real accounts.

## 3. Capability matrix

Evidence is a check file in `scripts/tenant-isolation/` unless it is a code path.
"F" numbers point to section 4.

### 3.1 Voice and calls

| Capability | Status | Evidence |
|---|---|---|
| Vapi webhook signature + timestamp over raw bytes; 401 for unsigned, tampered or stale | WORKING | `vapi-checks.ts` (6 variants, one log line); `lib/vapi-signature.ts` |
| Order: size cap -> raw bytes -> signature -> rate limit -> JSON -> Zod -> save | WORKING | `services/vapi-webhook.ts`; `vapi-checks.ts` (413, 400). The 429 branch has no check |
| Company comes from `phone_lines`, never the payload; a repeat delivery is saved once | WORKING | `vapi-checks.ts` (payload companyId ignored; B's call invisible to A; duplicate analyzed once) |
| Transcript encrypted at rest; no call data in logs | WORKING | `vapi-checks.ts`, `brain-analysis-checks.ts` |
| Vapi's real signing format and report field paths | BLOCKED | No Vapi account; `lib/validation/vapi.ts` paths are assumptions; header defaults differ (F12) |
| Phone line linking (operator script) and Setup display | PARTIAL | `setup-checks.ts` covers display and unlink; `scripts/link-phone-line.ts` has no check (F4) |
| Live call uses company knowledge, history or tools | MISSING | `services/vapi-webhook.ts:72-75` drops every message but end-of-call-report; no assistant-request or tool-calls handler |
| Transcript slice for Claude (4 + 16 turns, 8,000 chars, redaction, tag escape) | WORKING | `transcript-slice-checks.ts`, `brain-guard-checks.ts` |
| "solved" only with a whole confirming sentence of the customer's | WORKING | `brain-evidence-checks.ts`, `brain-guard-checks.ts` ("only decision.ts sets solved") |
| Every failure becomes needs_human; salvage only for needs_human | WORKING | `brain-guard-checks.ts`, `brain-failure-checks.ts`, `failure-report-checks.ts` |
| Claude adapter: per-use settings, no logging or tracing, fits 300 s | WORKING | `claude-adapter-checks.ts` (fake fetch), `hygiene-checks.ts`. Real API BLOCKED |
| One analysis at a time, stale redo, "Analyze now" | WORKING | `brain-analysis-checks.ts`; upper-case id defect (F2) |
| One ticket per needs_human call (same transaction), routed, expert emailed | WORKING | `call-ticket-checks.ts`, `routing-checks.ts`, `notification-checks.ts` |
| Escalate a "solved" call to a ticket (step 31) | WORKING | `call-escalation-checks.ts` (8 checks) |
| Recording copy: allowed hosts on every redirect, audio only, 100 MB | WORKING | `recording-checks.ts` (fake fetcher, dev storage). Real host and R2 BLOCKED |
| Recording playback (login + company check, signed link, 429) | PARTIAL | `recording-checks.ts` covers the dev path only (no Range support, so Safari may not play it); R2 signed link untested |
| Stuck call recovery by the daily job | WORKING | `stuck-work-checks.ts`; time budget defect (F3) |
| Calls list: filters, search, counts, pages, company only | WORKING | `call-list-checks.ts`, `pagination-checks.ts` |
| Call page states (loading, unreadable, analyzing, errors) | UNVERIFIED | In `app/calls/[callId]/`; only `not-found.tsx` existing is checked |
| Saves the conversation and outcome (outcome, reason, model, evidence) | WORKING | `brain-analysis-checks.ts`, `brain-failure-checks.ts` (database CHECKs) |

### 3.2 Email

| Capability | Status | Evidence |
|---|---|---|
| Resend webhook: same strict order, Standard Webhooks signature, repeats handled once | WORKING | `inbound-email-checks.ts` (401, nothing saved), `ops-checks.ts` (unsigned bounce) |
| Company from the forwarding address only, exactly one match | WORKING | `forwarding-checks.ts` (to, cc, bcc, received_for; two companies -> neither) |
| Fetching content from Resend Receiving (3 tries, 20 s each) | BLOCKED | Retries proven in `resend-receiving-checks.ts`; real response shape unconfirmed |
| Dev inbound stand-in through the same Zod schema | WORKING | `sender-authentication-checks.ts`, `hygiene-checks.ts` |
| Sender check (DKIM or DMARC pass, one "@", header and field agree) | WORKING | `sender-authentication-checks.ts`, `inbound-recovery-checks.ts`. Resend's real field BLOCKED |
| Filters: own address, support address, auto-reply, bulk, bounce, 10/hour flood | WORKING | `inbound-email-checks.ts`, `inbound-filter-checks.ts` |
| Claude triage of the customer's own words (redacted, tags neutralised, category by enum) | WORKING | `email-slice-checks.ts`, `inbound-email-checks.ts` (fake model). Real quality UNVERIFIED |
| 100 triages an hour per company, then a ticket without AI | WORKING | `inbound-filter-checks.ts` |
| Nothing lost: fallback ticket, 15-minute re-claim, late run never overwrites, daily stuck-email run | WORKING | `inbound-recovery-checks.ts`, `stuck-work-checks.ts` |
| Email becomes a routed ticket; original encrypted, company only | WORKING | `inbound-email-checks.ts` |
| HTML-only bodies, attachment and inline-image counts, size caps | WORKING | `inbound-content-checks.ts` |
| Emails page: list, "Process again", "Make a ticket anyway" | WORKING | `emails-page-checks.ts` |
| "Solved" email outbox (same transaction, one-UPDATE claim, idempotency key) | WORKING | `email-checks.ts`, `outbox-claim-checks.ts` |
| 300 customer emails a day per company; safe From header; fixed "solved" text | WORKING | `customer-email-safety-checks.ts`, `email-checks.ts` |
| Reply-To: company's reply-to, else its forwarding address | WORKING | `forwarding-setup-checks.ts` |
| Real delivery through Resend | BLOCKED | `adapters/resend.ts` runs only with SEND_REAL_EMAIL=true; no time limit (F5) |
| Bounces, complaints, suppressions on the sent email; "not delivered" list | PARTIAL | `ops-checks.ts`, `undelivered-email-checks.ts`; an early event is dropped (defect 13) |
| AI answers or acknowledges an email | MISSING | Triage output has no answer field; the only outgoing kind is `ticket_solved` |
| Knowledge and past tickets used in triage | MISSING | `services/inbound-email-triage.ts` sends the slice and category names only |
| Replies threaded onto the original ticket | MISSING | Every email makes a new ticket (known gap) |
| Record of who clicked "Make a ticket anyway", "Process again" or Retry | MISSING | No actor column; no "created" history row for those tickets |

### 3.3 Tickets, routing and team

| Capability | Status | Evidence |
|---|---|---|
| Ticket list: views, counts, search, pages, company only | WORKING | `ticket-checks.ts`, `ticket-queue-checks.ts`, `pagination-checks.ts` |
| Ticket numbers per company (safe when created at once); another company's number = "not found" | WORKING | `ticket-checks.ts`, `assignment-checks.ts` |
| Assign and unassign (same company, can take tickets, row locks) | WORKING | `assignment-checks.ts`, `ticket-change-checks.ts`, `ticket-eligibility-checks.ts` |
| Category routing (least busy, ties to who joined first); waiting tickets routed on a category pick or restore | WORKING | `routing-checks.ts`, `backlog-routing-checks.ts` |
| Same-customer routing (phone 7+ digits, or email) | WORKING | `repeat-customer-checks.ts` |
| Routing runs one at a time per company (company row lock) | WORKING | `concurrency-checks.ts`; rename takes no lock (F7) |
| "Mark as solved" only for the address the person saw (email queued in the same transaction); close without emailing | WORKING | `closing-checks.ts`, `ticket-email-checks.ts` |
| Reopen (owners only), routed again if the assignee was removed | WORKING | `assignment-checks.ts`, `ticket-eligibility-checks.ts` |
| Enter the customer's email (confirm step); edit subject or customer name | WORKING | `ticket-email-checks.ts`, `ticket-details-checks.ts` |
| Internal notes (encrypted) and ticket history | WORKING | `ticket-note-checks.ts`, `ticket-history-checks.ts` |
| "New ticket" typed in by a person | WORKING | `manual-ticket-checks.ts` |
| Categories: owners add, rename, archive, restore | WORKING | `category-checks.ts`; control characters accepted (F6) |
| Each person picks their categories | WORKING | `category-checks.ts`, `concurrency-checks.ts`; 50-category cap (F8) |
| Remove a teammate (sessions, password, links, invites end; tickets re-routed); delete a never-confirmed account | WORKING | `removal-checks.ts`, `unconfirmed-invitee-checks.ts` |
| Role changes; a company always keeps an owner | WORKING | `team-checks.ts` |
| Invites (owner only, hashed token after "#", single use, 7 days, limits) | WORKING | `invite-checks.ts`, `owner-invite-checks.ts`, `invite-limit-checks.ts`, `takeover-checks.ts` |
| Assignment emails ("a ticket is yours") | WORKING | `notification-checks.ts` (dev outbox; best effort, no retry) |
| Dashboard first-run hints, assignee menu | WORKING | `first-run-checks.ts` |
| Permission and error states | WORKING | `team-checks.ts`, `category-checks.ts`, `ui-polish-checks.ts`; rendering not tested |
| A rate limit on every action | WORKING | `manual-ticket-checks.ts`, `ticket-note-checks.ts`, `invite-limit-checks.ts` |
| Routing accuracy and wrong-"solved" rate shown to people | PARTIAL | Data kept (`routed_to_user_id`, history rows, `calls.escalated_at`); no page shows it |
| Record of team and admin actions (roles, removals, categories, revokes) | MISSING | `db/team-members.ts`, `db/invites.ts`, `db/categories.ts` store no actor |
| Alert when a ticket routes to nobody | MISSING | `db/routing.ts` returns null; only the "Unassigned (n)" link shows it |
| What fixed it, recorded on solve | MISSING | `db/ticket-solving.ts` stores status, time and solver only |

### 3.4 Auth, security and tenancy

| Capability | Status | Evidence |
|---|---|---|
| Signup (new company, owner) and joining by invite; companyId and role from the request ignored | WORKING | `signup-checks.ts` (12 at once all finish), `invite-checks.ts`, `takeover-checks.ts` |
| Email verification: link and password together | WORKING | `verification-checks.ts`, `auth-handler-checks.ts` |
| Login limits (IP, address + IP, address, known device) | WORKING | `login-limit-checks.ts`, `known-device-checks.ts` |
| Logout | UNVERIFIED | `services/auth.ts` calls signOut; no check calls it |
| Password reset | WORKING | `password-reset-checks.ts`, `unconfirmed-invitee-checks.ts` |
| Account page: name, password, log out other devices, fixed 7-day logins | WORKING | `account-checks.ts` |
| A removed teammate is shut out everywhere | WORKING | `removal-checks.ts`, `team-checks.ts` |
| Company and role come only from the session | WORKING | `lib/session-context.ts`; `team-checks.ts`, `signup-checks.ts` |
| Better Auth's HTTP handler not mounted; risky endpoints off | WORKING | `auth-handler-checks.ts` |
| Logged-out redirect and safe `?next=` | WORKING | `login-redirect-checks.ts` |
| Tenant isolation in `/db` (company_id in every WHERE and INSERT) | WORKING | Review of every `db/*.ts` function; `trusted-field-checks.ts` and the cross-company case in each check file. No Row Level Security behind it |
| ESLint guard that keeps queries in `/db` | PARTIAL | `lint-guard-checks.ts` proves 25 bypasses fail; three others pass (F10) |
| Rate-limit store (Postgres upsert, HMAC keys) | WORKING | `hygiene-checks.ts`, `ops-checks.ts` |
| Encryption at rest tied to company and record | WORKING | `brain-analysis-checks.ts`, `ticket-note-checks.ts`; tag length not pinned (F9) |
| Error logs without customer data | WORKING | `ops-checks.ts`, `ops-maintenance-checks.ts` |
| Startup settings check (names the setting, never its value); database pool limits | WORKING | `ops-readiness-checks.ts` |
| Security headers | PARTIAL | Set in `next.config.ts`; only the missing X-Powered-By is checked; no CSP |
| Real delivery of account emails (confirm, reset) | BLOCKED | Needs Resend |
| Trustworthy client IP in production | BLOCKED | Hosting not chosen; `lib/request-ip.ts` trusts x-forwarded-for |
| Record of security events (logins, password changes, removals, roles) | MISSING | Nothing records them |
| MFA, SSO, CAPTCHA, email change, account deletion | MISSING | `lib/auth.ts` loads only the nextCookies plugin |

### 3.5 Files, setup, billing, ops and UI

| Capability | Status | Evidence |
|---|---|---|
| Private storage switch; keys `<kind>/<companyId>/...` | WORKING | `setup-checks.ts` (dev stand-in) |
| R2 storage and 5-minute signed links | BLOCKED | `adapters/r2.ts` never runs in checks; no account |
| Document upload rules (types, 4 MB) in the browser and on the server | WORKING | `setup-checks.ts`; extension only, no content or malware check |
| Documents company only, managed by owners; cap of 100 files, 200 MB | WORKING | `setup-checks.ts`, `document-cap-checks.ts` |
| Storage failures shown as messages; downloads answer 429 when over limit | WORKING | `file-failure-checks.ts` |
| The AI reads uploaded documents | MISSING | Nothing extracts text; Setup says "The AI does not read them yet." |
| Setup: owners change, members read; checklist and dashboard hints | WORKING | `setup-checks.ts`, `account-checks.ts`, `first-run-checks.ts` |
| Forwarding address and last email on Setup | WORKING | `forwarding-setup-checks.ts`; stuck-email wording (F11) |
| Phone numbers, read-only, with their last call | WORKING | `setup-checks.ts`, `ops-maintenance-checks.ts` |
| Billing modes (stripe, dev, off), owners only | WORKING | `billing-checks.ts`, `failure-report-checks.ts` |
| Stripe webhook (signature, company choice, billing never moves) | WORKING | `billing-checks.ts`, `billing-company-checks.ts` |
| Stripe Checkout and customer portal | BLOCKED | Needs STRIPE_SECRET_KEY; double checkout (F1) |
| Payment enforcement | MISSING | Nothing reads billing outside `/billing` (known gap) |
| Daily cleanup in batches | WORKING | `ops-checks.ts`, `ops-maintenance-checks.ts` |
| Stuck work from the daily job | PARTIAL | `stuck-work-checks.ts`; budget can pass 300 s (F3) |
| Health endpoint; production setting warnings | WORKING | `ops-readiness-checks.ts` |
| CI workflow | UNVERIFIED | `ops-maintenance-checks.ts` reads `checks.yml`; it has never run |
| Header: one fixed-height line, fits a phone | UNVERIFIED | Read from `components/app-header.tsx`; no check or render |
| Error, not-found and loading states | WORKING | `ui-polish-checks.ts`; loading text isn't announced (role=status) |
| Destructive buttons ask first | UNVERIFIED | `components/confirm-button.tsx`; no check |
| Public website (landing, pricing, privacy, terms) | PARTIAL | Static pages; legal pages show a draft notice; two claims to fix (section 4.2) |

## 4. Defects found

### 4.1 Defects from the reviews and the research

"Code read" means this report re-read the cited code and the cause is there.
No check reproduces the failure yet.

| # | Defect | Severity | Verified | Handled by |
|---|---|---|---|---|
| 1 | Stripe: paying twice before the first webhook lands (slow or failing webhook, two tabs) creates a second customer and subscription. ansa keeps one and drops the other with no log line; the portal can't show it, so the owner can't cancel it. The Billing page shows "Stripe is confirming your payment" and Subscribe at the same time. `services/stripe-webhook.ts:82`, `app/billing/billing-panel.tsx` | Medium | Yes, adversarial pass | F1 |
| 2 | Vapi signature header defaults (`x-vapi-signature`, `x-vapi-timestamp`, `lib/env.ts:69-70`) differ from Vapi's HMAC credential defaults (`x-signature`, `x-timestamp`). Unless someone sets them, every real call gets 401 and is lost (Vapi doesn't retry). | Medium (setting) | Against Vapi's API spec; not on a real account | F12 |
| 3 | "Analyze now" with an upper-case call id encrypts the AI notes under a context nothing can decrypt: the issue and the customer's sentence are lost, and logs falsely say "check DATA_ENCRYPTION_KEY". `lib/validation/vapi.ts:67` | Low | Code read | F2 |
| 4 | The daily job can run past its 300 s limit. Its clock starts after cleanup, it keeps starting work for 120 s, and one call analysis can take about 180 s. The host kills it mid-analysis and the call waits a day. `services/stuck-work.ts:13,43` (found by two reviews) | Low | Code read | F3 |
| 5 | `pnpm link:phone-line` takes the company of any user row with that email (an unconfirmed invitee, a removed person, a member) and doesn't print the company. A number can land on the wrong company, which then gets its transcripts. `scripts/company-of-user.ts` | Low | Code read | F4 |
| 6 | Sending through Resend has no time limit. A stalled API holds "Mark as solved" until the host kills it, and blocks the assignment emails behind it. `adapters/resend.ts:19` | Low | Code read | F5 |
| 7 | Ids and category names with NUL or control characters reach SQL and crash the action instead of being refused. A line break in a category name becomes an extra line in Claude's category list. `lib/validation/categories.ts`, `team.ts`, `tickets.ts` | Low | Code read | F6 |
| 8 | Setting a ticket's category while an owner renames it throws a foreign-key error (error screen) instead of "refused": the rename takes no company lock. `db/ticket-updates.ts:99`, `db/categories.ts:62` | Low | Code read | F7 |
| 9 | One person can save at most 50 categories, but a company can have any number. Over 50 says "Unknown person or category." `lib/validation/categories.ts:31` | Low | Code read | F8 |
| 10 | AES-GCM decryption accepts short authentication tags. A forged value with a 4-byte tag takes about 2^32 tries instead of 2^128. It needs write access to the database first. `lib/encryption.ts:46` | Low | Code read | F9 |
| 11 | The `/db` lint guard misses `createRequire("pg")`, an aliased `require`, and Better Auth's raw adapter through `auth.$context`, which reads and writes users with no company filter. `eslint.config.mjs:47-69` | Low | Code read | F10 |
| 12 | Setup says a stuck email "is being turned into a ticket" forever, with no link to "Process again". `app/setup/email-section.tsx:87` | Low | Code read | F11 |
| 13 | A Resend delivery-problem event (bounce, suppression) that arrives before ansa records "sent" matches nothing and is dropped. The ticket then says the email went out. `db/email-delivery-events.ts:19` | Low | Code read | Kept as known gap |

### 4.2 Smaller findings not in Stage 1

| Finding | Where | Severity | Status |
|---|---|---|---|
| Build warning: a dynamic `readdirSync` makes Turbopack trace the whole project into the server output (slower deploys, size limits). | `lib/production-warnings.ts:91` | Low | Not scheduled |
| A Vapi report with one slightly long optional field (caller id over 40 characters, endedReason over 200, recording URL over 2,000) is refused whole with 400, and the call is lost. | `lib/validation/vapi.ts` | Low | Under the known "unexpected shape" gap |
| The landing page says isolation is "tested automatically every time our code changes". CI has never run. | `app/(marketing)/page.tsx:32` | Low (content) | Not scheduled |
| The terms say the plan keeps working to the end of the paid period. That needs the Stripe portal set to cancel at period end, which `docs/going-live.md` section 6 doesn't say. | `app/(marketing)/terms/page.tsx:48` | Low (content) | Not scheduled |
| R2 risks to try on a real bucket: the SDK's default checksums, seeking a recording after its 5-minute link expired, a missing object answering with R2's own error. | `adapters/r2.ts`, `lib/private-file-response.ts` | Unknown | Try on a real bucket |
| Loading text isn't announced to screen readers; no skip-to-content link. | page fallbacks | Low | Not scheduled |

## 5. Gaps against the brief

### 5.1 Module A flow

| Step | Status | Today | Missing (planned step) |
|---|---|---|---|
| 1. AI receives the call | PARTIAL, BLOCKED | One Vapi assistant, set up by hand in ansa's Vapi account, talks to every caller. ansa only receives the end-of-call report. | Per-company greeting and prompt (no assistant-request handler). A real Vapi account. |
| 2. Understands the issue | WORKING (fakes) | After the call, Claude reads a redacted slice and picks solved or needs_human and a category. | Real model quality, measured on real calls (no eval set). |
| 3. Searches company knowledge | MISSING | Documents are stored and listed, never read. | Knowledge base (34) and a live-call tool (35). |
| 4. Searches past support records | MISSING | History is used only to route a repeat customer and list their other open tickets. | "Save as knowledge" on solved tickets (34). |
| 5. Gives a verified answer | PARTIAL | Calls: "solved" needs the customer's own confirming sentence; nothing checks the answer itself. Email: the AI never answers. | Answers backed by approved articles; which article was used (35). AI email replies are an open decision. |
| 6. Creates a ticket when unresolved | WORKING | Calls, emails, typed tickets and escalations; ticket and decision in one transaction. | The caller is never told a ticket number; no live transfer to a person. |
| 7. Notifies the right team | WORKING, best effort | The routed or assigned expert is emailed after the save. | No retry, no in-app notice; a ticket that routes to nobody tells nobody. |
| 8. Saves the conversation and outcome | PARTIAL | Calls keep the encrypted transcript, outcome, reason and evidence. Emails keep the encrypted original. | No "what fixed it" on solve; email triage outcome isn't stored as data; replies aren't threaded. |

### 5.2 Security list

| Item | Status | Notes |
|---|---|---|
| Tenant isolation | WORKING | Code only (no RLS). Lint guard gaps (F10). New raw SQL (full-text search) needs the same care. |
| Company from the session only | WORKING | Never from the request; role re-read on every request. |
| Input validation (Zod) | WORKING | Control characters slip through in some schemas (F6). |
| Encryption at rest | WORKING | Per company and record. F9; no key rotation; DATA_ENCRYPTION_KEY must be backed up. |
| Webhook signatures | WORKING | Vapi, Resend, Stripe before parsing. Real formats BLOCKED; F12. |
| Rate limits | WORKING | Postgres counters. Per-IP limits trust x-forwarded-for until hosting is chosen. |
| Logs without customer data | WORKING | Class names only near call and email content. |
| Data sent to Claude | WORKING | Smallest slice, redacted. Phone numbers said on a call are not redacted. |
| Prompt injection | PARTIAL | Customer text sits in escaped tags; Claude has no tools; output is a fixed schema with categories by enum; "solved" needs the customer's words. Owner-typed category names can add lines (F6). Knowledge text must follow the same rule (plan, step 34). |
| Audit trails | PARTIAL | Ticket changes only (`ticket_activity`). Nothing records team, role, setup, billing or operator actions, logins, password changes, filter overrides, Retry clicks, or who viewed a transcript or played a recording. |
| Retention and deletion | MISSING | Only rate counters, expired sessions and reset links are deleted. Calls, recordings, emails and tickets are kept forever. No account deletion or data export. |
| Personal data on screen | MISSING | Every teammate sees full transcripts and recordings, card numbers included. |
| Roles and permissions | PARTIAL | Owner and member only. Operator actions are scripts with no audit (F4). |
| MFA, SSO, CAPTCHA | MISSING | Password plus login limits. |
| Security notification emails | MISSING | A password change or reset tells nobody. |
| Security headers and CSP | PARTIAL | Headers set; no Content-Security-Policy. |
| File upload safety | PARTIAL | Type list, size caps, private storage, downloads as attachments. No content or malware check. |
| Server-side fetches (SSRF) | WORKING | Recording downloads: https, allowed hosts, every redirect checked. |
| Billing enforcement | MISSING | Payment is recorded, never enforced (known gap). |

## 6. Module B: AI Co-Founder

**Status: MISSING in full.** Nothing in `app/`, `services/`, `db/` or
`adapters/` touches business profiles, marketing, content, media or social
accounts. Every part is MISSING, with its planned step: shared company
knowledge (34), business profile and onboarding interview (36), marketing
strategy from confirmed facts (37), content drafts with claims checked against
facts (38), media library and generation (39; provider OPEN), social account
connections (40; real accounts BLOCKED), publishing queue, calendar, owner
approvals and audit trail (41), post metrics and recommendations (42), one
shared navigation and overview (43).

**What it can reuse.**

| Piece | Where | Use for the Co-Founder | Mind |
|---|---|---|---|
| Signed-in section shell | `lib/login-redirect.ts` SIGNED_IN_SECTIONS, `proxy.ts`, `components/app-frame.tsx`, `components/app-header.tsx` | Login redirect, header, error boundary | A check keeps the proxy matcher and the list equal; session reads go inside Suspense |
| Tenant `/db` pattern and lint guard | `db/*.ts`, `eslint.config.mjs` | company_id on every row and WHERE; same-company keys to users | The guard checks imports, not WHERE clauses |
| Owner gating | `services/setup.ts` ownerGuard, `db/team-members.ts` | Approvals, connecting accounts | Only owner and member roles exist |
| Offboarding | `db/teammate-access.ts`, `db/unconfirmed-accounts.ts` | Revoke a removed person's drafts, approvals, tokens | New keys to users must be cleared there, or deletes fail |
| Documents | `services/documents.ts`, `db/documents.ts`, `lib/document-files.ts` | Brand and product material already uploaded | No text extraction; storage can't read bytes back in R2 mode |
| Encryption | `lib/encryption.ts`, `lib/encryption-contexts.ts` | Social tokens, interview answers | Better Auth's token encryption covers only its own table; fix F9 first |
| Claude adapter pattern | `adapters/claude.ts`, `lib/model-request.ts`, `claude-adapter-checks.ts` | One function and settings object per use; fakes in checks | No tools in the request; timeout x tries must fit 300 s |
| Rate limits | `services/rate-limit.ts` | Caps on paid generation and publishing | Cleanup follows the longest window by itself |
| Private file storage | `lib/file-storage.ts`, `adapters/r2.ts` | `media/<companyId>/...`, 5-minute signed links | R2 BLOCKED |
| Safe download | `lib/recording-download.ts` | Copy generated media from provider links at once | Allowed hosts per provider |
| Outbox pattern | `outgoing_emails`, `db/outgoing-email-delivery.ts` | Publish jobs: row in the same transaction, claimed in one UPDATE | No platform has an idempotency key: an unclear answer is never retried blindly |
| Background work | `after()`, `services/stuck-work.ts`, `db/stuck-work.ts`, `app/api/cron/cleanup` | Jobs that survive restarts | Daily cron on Vercel Hobby; fix F3 before adding work |
| Billing hook | `db/billing.ts` getCompanyBilling | Gating a paid add-on | Nothing enforces billing yet; needs a second Stripe price |
| Company-scoped counts | `db/tickets.ts` per-view counts, call outcomes | Ticket counts per category, if an owner allows it | Counts only, never ticket text (Rule 1) |
| Safe error logging | `lib/safe-error-logging.ts` | Failures without content | Never log prompts or model output |

**Do not reuse as-is:** the customer email path for marketing mail. All
companies share one sending address and Resend account (one company's spam
complaints suppress addresses for all), and it can't add List-Unsubscribe.
Every new provider must be named on the privacy page.

## 7. Blocked on outside accounts

| Service | Built and proven locally | Needs the real account to confirm | Stand-in |
|---|---|---|---|
| Vapi | Signed webhook, call saving, brain, tickets, recording copy | Signing format and header names (F12), report field paths, hidden-caller numbers, recording host. Live tools (step 35): `arguments` may be a string or an object (docs disagree); always answer 200 with one-line results; 20 s default timeout; a server URL sent inline gets no credential | `pnpm simulate:vapi-call`, `simulate:solved-call` |
| Resend sending | Outbox, idempotency key, From header, daily cap, delivery events | Real delivery and event payloads; F5 under a real stall | `.dev-emails/` |
| Resend receiving | Signature, forwarding routing, sender check, filters, retries | Which field holds the forwarding address; the `authentication` shape; how long Resend keeps mail | `.dev-inbound/` |
| Cloudflare R2 | Key layout, caps, failure messages | Uploads, signed links, seeking, missing objects (section 4.2) | `.dev-files/` |
| Stripe | Webhook signature (Stripe's own test header), company choice | Checkout, portal, cancel-at-period-end; F1 | Simulate buttons on `/billing` (dev only) |
| Anthropic | Request shape, settings, 300 s budget, every failure -> needs_human | Real answer quality. Without a key every call escalates ("model unavailable") | Fake models in checks |
| Hosting (Vercel proposed, not decided) | Build output, health and cron routes | x-forwarded-for trust, log retention (searches sit in URLs), cron frequency, idle connections | `pnpm dev` |
| Neon | Warnings for a non-pooled address | statement_timeout set on the database role | Docker Postgres |

Step 20 (first vendor adapter, e.g. Shopify or Zendesk) is BLOCKED until the
first customer's vendor is known; no business-system adapter exists.

**Social platforms** (official docs, 2026-10-26; details in
[docs/research/social-publishing-apis.md](docs/research/social-publishing-apis.md)):

| Platform | What the API allows | Access blocker |
|---|---|---|
| LinkedIn, member | Text, image and video posts; no scheduling | Analytics need the Community Management API: a registered legal entity, business email, app verified by a Page super admin; a rejection is final for that app. Tokens last 60 days; refresh tokens only for approved partners |
| LinkedIn, page | The same, posted as the page | Community Management review; Development tier is 500 calls per app per day; Standard tier needs a screencast |
| Facebook Pages | Text, photo and video; native scheduling | App Review per permission (screencast); other businesses' Pages need Business Verification; data access lapses 90 days after the user was last active |
| YouTube | Video only (no text posts through the API) | Google OAuth verification (unverified apps: warning screen, 100 users; testing mode: 7-day refresh tokens); 100 uploads a day per project, shared by all customers; whether unaudited uploads stay private is unclear in the docs |
| X | Text, images and video; no scheduling | Pay per use: $0.015 a post, $0.20 a post with a link; credits bought in console.x.com |

**Image and video provider: not chosen (OPEN).** Anthropic makes no images.
Options ([docs/research/vapi-tools-media-anthropic.md](docs/research/vapi-tools-media-anthropic.md)):
OpenAI images (its Sora video API shut down 2026-09-24), Google Gemini images
and Omni Flash video (about $0.10 a second at 720p), Stability (images only),
Black Forest Labs FLUX (result links expire after 10 minutes), Replicate,
Runway, Luma. Copy outputs to private storage at once and keep the original
bytes (editing strips C2PA provenance).

**Anthropic:** no embeddings API (so the plan uses Postgres full-text search);
Claude reads PDFs directly, .docx needs text extraction; the Files API is not
eligible for zero data retention.

## 8. Inaccessible or not checked

- **No git remote, nothing committed.** `git remote` lists nothing. 408 files
  are staged (+45,231 / -2,751 lines), 58 have unstaged edits, and 10 paths besides
  this report are untracked (among them migration 0027, the health route and two check files,
  which a plain `git commit -a` would miss). A disk failure loses all of it. An
  archive, `ansa-backup-before-cofounder.tgz` (5.6 MB), sits in a temporary
  folder that gets cleared; copy it somewhere lasting and add a remote:
  `/private/tmp/claude-501/-Users-rafa-Documents-business-ansa/ea7ef233-7668-41b6-971a-f88b5e4fac57/scratchpad/ansa-backup-before-cofounder.tgz`
- **CI has never run.** A check reads `.github/workflows/checks.yml`, but it has
  never run on GitHub (nor its audit job or action versions).
- **No real accounts.** Everything in section 7 is proven against stand-ins only.
- **No browser tests.** No end-to-end or render tests exist. Page states, the
  header at phone width, forms keeping what was typed and confirm buttons were
  judged from code; `ui-polish-checks.ts` reads files, it renders nothing.
- **Paths no check covers:** logout, the Vapi webhook's 429 answer, security
  headers other than X-Powered-By, `scripts/link-phone-line.ts`, R2 signed links.
- **Not measured:** AI quality (no eval set; a wrong "solved" counts only when a
  teammate escalates it, and no page shows the count), speed and load.
- **Not reviewed here:** the legal text (needs a lawyer; `lib/site.ts` still holds
  placeholders), `docs/going-live.md` beyond the points named above, and
  dependency vulnerabilities (`pnpm audit` was not run).
