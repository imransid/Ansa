# Project: AI Voice Support Agent (SaaS)

## What we are building
A plug-and-play AI agent that replaces first-line human support.
It answers phone calls and emails for any company, solves what it can,
and creates a ticket for a human expert when it can't.

## Flow
1. Customer calls -> AI answers, listens, understands
2. AI can solve -> answers on the call, done
3. AI cannot solve -> creates ticket with call notes
4. Ticket auto-assigned to the right human expert
5. Expert marks solved -> customer gets an automatic email
6. Email channel works the same way, same brain

## Stack
- Next.js (App Router, TypeScript) - frontend + backend API routes
- Postgres - local in Docker for development, Neon in production later
- Drizzle ORM - schema + migrations (migrations live in the repo)
- Better Auth - email/password auth and sessions
- Cloudflare R2 - file storage (call recordings, uploaded docs), added later
- Vapi - telephony, speech-to-text, text-to-speech
- Claude API - the agent brain
- Resend - outgoing email
- Tailwind + shadcn/ui - dashboard UI
- No Supabase.

## Architecture rules
- Monolith. One Next.js app. No microservices.
- Multi-tenant. EVERY tenant table has company_id. EVERY query filters by it.
  - Exceptions: Better Auth's own tables (sessions, accounts, verifications)
    are keyed by user, not company. rate_limits is keyed by a hashed IP/email,
    because limits apply before we know who you are.
- Tenant isolation lives in ONE shared data access layer: /db.
  - There is no Row Level Security. /db is the only thing keeping one
    company's data away from another. Treat every change there that way.
  - Only /db talks to the database. No queries in pages, route handlers,
    server actions, or services.
  - Every /db function that touches tenant data takes companyId as a
    required argument, filters by it in every WHERE, and sets it on every INSERT.
  - companyId always comes from the server-side session, never from the request.
    Get it with requireSessionContext() (lib/session.ts) and pass the session down.
  - Exception: Better Auth reads and writes its own tables through its Drizzle
    adapter, configured in lib/auth.ts.
  - ESLint enforces this: importing drizzle-orm, pg or @/db/client outside /db is an
    error, and /app may not import /db at all.
- Request flow: page / route handler / server action -> /services -> /db
- Auth: Better Auth's HTTP handler (/api/auth/*) is NOT mounted. Signup, login and
  logout go through server actions -> services/auth.ts (validated + rate limited).
  Which company a new user joins is decided in ONE place: the user-create hook in
  lib/auth.ts -> services/company-membership.ts (new company as owner, or the
  inviting company with the invited role). Never enable `transaction: true` on
  the Better Auth adapter: signups would deadlock on DB connections (see lib/auth.ts).
- Invite links put the token after "#" so it never reaches the server or its logs.
  Only a SHA-256 hash of the token is stored.
- Email verification (step 12): no session until the address is confirmed
  (requireEmailVerification). The emailed link also uses "#<token>" (we ignore
  Better Auth's own "?token=" url); app/verify-email reads it in the browser.
- Any column that points at a user (assignee, solver, ...) gets a composite foreign
  key (company_id, user_id) -> users(company_id, id), so Postgres itself refuses a
  user from another company. See db/schema/tickets.ts. drizzle-kit may write that
  foreign key before the unique constraint it needs: check the migration order.
- User ids from forms are only claims. Updates check them inside the same SQL
  statement (see db/ticket-updates.ts), never in a separate earlier read.
- Routing (step 10, db/routing.ts): every new ticket with a category, and every
  unassigned ticket whose category is set, goes to the expert in the SAME company
  who handles that category and has the fewest open tickets (ties: joined first),
  in the same transaction. Routing never takes a ticket from someone. Every
  assignment records how it happened: tickets.assigned_automatically (true =
  routed, false = a person, null = unassigned) and tickets.routed_to_user_id
  (routing's first pick, never overwritten) so routing accuracy can be measured.
- Category names are owner-managed settings, sent to Claude with the transcript
  slice. Claude may only answer with one of the company's active names, or "".
- Email: core code only calls sendEmail() in lib/send-email.ts. It writes to
  .dev-emails/ (adapters/dev-email-outbox.ts) unless SEND_REAL_EMAIL is exactly
  "true", then it uses adapters/resend.ts. Never call Resend directly.
- Webhooks (services/vapi-webhook.ts) always run in this order: size cap -> raw
  bytes -> signature + timestamp -> rate limit -> JSON parse -> Zod -> save. The
  company comes from our phone_lines table, never from the payload.
- Call brain (step 7): lib/call-brain/ holds the slice, prompt, output schema and
  guards; adapters/claude.ts is the ONLY file that talks to Anthropic;
  services/call-analysis.ts runs it after the webhook responds (Next's after()).
  - Claude never gets company, caller number or ids, has no tools, and its output
    has no company/call field. The service applies the decision to the call it asked about.
  - Anything missing, malformed, unexpected, refused, truncated or failed becomes
    "needs_human". "solved" needs the customer's own words, found verbatim in a
    customer turn of the slice. Never add a path that defaults to "solved".
  - Checks use fake models (DecisionAsker). Never call the real API from checks.
  - Every "needs_human" creates a ticket in the SAME transaction as the decision
    (db/call-analysis.ts). tickets.call_id is unique (one ticket per call) and has
    a same-company foreign key. The ticket gets Claude's short summary in plain
    text; the transcript never goes on a ticket, it stays encrypted on the call.
- Whoever a ticket lands on gets an email (services/assignment-notifications.ts),
  sent AFTER the save, whatever the path: routing at creation, routing after a
  call, routing when a category is set, or a person assigning. Never for assigning
  yourself. The email holds number, subject and category only: no customer data.
- Sensitive text at rest (transcripts now, OAuth tokens later) goes through
  lib/encryption.ts with a context naming its company and record.
- Every customer email is first a row in outgoing_emails, written in the same
  transaction as the change that causes it, then delivered right after commit.
  The row id is the idempotency key, so a retry never sends twice.
- Times: stored in UTC, shown with components/local-date-time.tsx (the viewer's own
  timezone). Lists page with ?page= (lib/pagination.ts, 50 per page).
- Next.js 16 has Cache Components on: any component that reads the session must
  sit inside <Suspense>. See app/dashboard/page.tsx. Read @AGENTS.md before
  writing Next.js code; this version differs from older docs.
- Adapter pattern for third-party software:
  - Core code only calls generic actions: getOrder, getCustomer, createTicket
  - One adapter file per vendor: /adapters/shopify.ts, /adapters/zendesk.ts
  - Adding a new vendor = adding one file. Nothing else changes.
- No CQRS, no event sourcing, no DDD layers. Keep it boring.
- Folder shape:
  /app/api      -> thin route handlers, max ~15 lines each
  /services     -> all business logic
  /adapters     -> third-party translators
  /db           -> schema, migrations, and the data access layer (the only code that queries)
  /lib          -> shared helpers

## RULE 1: SECURITY IS NON-NEGOTIABLE
- Tenant isolation enforced in /db on every query (see Architecture rules), no exceptions
- Never trust company_id from the client. Always read it from the Better Auth session on the server.
- Validate every input with Zod before it touches the database
- Never log API keys, tokens, phone numbers, call transcripts, or recording URLs,
  anywhere, including error logs. Database errors contain query values, so log
  only an error's class name in code that handles call data.
- All secrets in .env.local only. Never hardcode. Never commit .env
- Encrypt stored third-party OAuth tokens at rest
- Claude API: send the smallest slice of customer data that does the job, never a
  whole transcript when less will do. Never log the prompt, Claude's raw response,
  or SDK error messages (they can quote the response).
- Verify webhook signatures on every incoming webhook (Vapi, Resend) before parsing
  anything: read raw bytes for the HMAC only. Unsigned or badly signed requests get
  401 and the only log line is the rejection.
- Rate limit all public endpoints (counters stored in a Postgres table, no Redis)
- Parameterized queries only. Use Drizzle's query builder or its sql`` template.
  Never sql.raw() with user input. Never string-concatenate SQL.
- Files (call recordings, uploaded docs): private R2 bucket, short-lived presigned URLs only, never public
- Before finishing any task, re-check it against this list

## RULE 2: CODE MUST BE EASY TO UNDERSTAND
- Write for a junior developer reading it 6 months from now
- Clear names over short names: getTicketsForCompany, not gtfc
- Small functions, one job each
- No clever one-liners, no deep nesting, no premature abstraction
- Comment only the WHY, never the WHAT
- Every service function gets a one-line comment saying what it does
- If a file passes ~200 lines, split it
- Prefer obvious and repeated over DRY and confusing

## RULE 3: GIT COMMITS
- Commits are authored by me only
- NEVER add "Co-Authored-By: Claude" or any co-author trailer
- NEVER add "Generated with Claude Code" or any tool attribution
- Commit message = plain description of the change, nothing else
- Example: "add ticket assignment to expert by category"

## How to work with me
- Build ONE feature at a time. Stop and let me test before moving on.
- Before writing code, tell me your plan in 3-5 lines and wait for yes.
- If something is unclear, ask. Do not assume.
- After each feature, tell me exactly how to test it.

## Build order
1. Next.js + Postgres + Drizzle setup, Better Auth, companies and users tables
2. Tickets table + dashboard list page
3. Invite teammates to a company
4. Assign ticket to a user, mark as solved
5. Resend email on solved
6. Vapi webhook receiving a call transcript
7. Claude brain: decide solve vs escalate
8. Auto-create ticket on escalate
9. Expert enters the customer's email on a ticket
10. Route tickets to experts by category (each person picks the categories they handle)
11. Ticket and call lists in pages (no 50 cap), times in each viewer's local time
12. Email verification at signup
13. Email the expert when a ticket lands on them
14. Call recordings stored in a private R2 bucket, viewed via short-lived links
15. Email channel using the same brain (inbound provider: confirm at this step)
16. Company onboarding flow (categories, team, phone number, reply-to, upload docs to R2)
17. Going live: hosting (confirm at this step), Neon, checks on every push, error
    monitoring without call data, rate-limit cleanup, Resend bounce webhook
18. Payments (provider and pricing: decide at this step)
19. Website: landing page, pricing, privacy policy and terms
20. First adapter (whichever vendor my first customer uses). BLOCKED until known.

Every outside service gets a local stand-in (like .dev-emails/), so each step can
be built and tested before the real account exists.

Do not jump ahead. Finish step N before starting step N+1.

## Known gaps (revisit later)
- Email verification (step 12) works, but the link only reaches people once real
  email is on (SEND_REAL_EMAIL=true). Until then links land in .dev-emails/.
- Opening an already-used verification link just leads to the login page.
- An invite is marked used just before Better Auth saves the new user. If saving
  then fails, the invite is spent and the owner has to create a new one.
- Signup inserts the company before Better Auth inserts the user, in separate
  transactions. If the user insert fails, an empty company row is left behind.
- The IP used for rate limiting comes from x-forwarded-for. That header is only
  trustworthy behind a host that overwrites it (Vercel, Cloudflare). Check when hosting is picked.
- Old rate_limits rows are never deleted. Add a cleanup job when it matters.
- Production must set SEND_REAL_EMAIL=true. Otherwise emails go to .dev-emails/,
  which fails on read-only hosting, and tickets show "Email failed".
- No automatic email retries: if the server stops between saving and sending, the
  email stays "not sent yet" until someone clicks Retry on the ticket.
- No Resend webhooks yet (bounces, deliveries). When added, verify signatures (Rule 1).
- Vapi's real signing format is NOT confirmed yet (no account). On the first real
  call, compare Vapi's Webhook Logs (dashboard) with the VAPI_* settings in
  lib/env.ts and adjust env only. Also confirm the end-of-call-report field paths
  in lib/validation/vapi.ts. Vapi only signs when the server URL comes from saved
  config (assistant, phone number, Server Configuration), not inline API calls.
- Testing real calls locally needs a tunnel (e.g. cloudflared) so Vapi can reach
  /api/webhooks/vapi. Until then use pnpm simulate:vapi-call.
- Call recordings are dropped. Copying them into a private R2 bucket is later work.
- DATA_ENCRYPTION_KEY must be backed up; losing it loses every transcript. There is
  no key rotation yet (the "v1:" prefix leaves room for it).
- Phone lines are linked with pnpm link:phone-line until onboarding (step 16).
- Call brain quality is unmeasured: no eval set yet. Collect real calls, then
  tune the prompt, effort and model against them before trusting "solved".
- The transcript parser assumes Vapi's "AI:" / "User:" labels. Confirm with the
  first real transcript (lib/call-brain/transcript-slice.ts).
- Transcript slices are sent to Anthropic, which keeps API data for a limited
  time by default. Zero data retention is an org-level arrangement with Anthropic.
- The system prompt is too short for prompt caching to apply, so it isn't cached.
- Tickets from calls have no customer email (we never extract one from a
  transcript: a misheard address would leak details to a stranger), so the
  "solved" email (step 5) does not go out for them until an expert enters the
  customer's email on the ticket (step 9).
- Adding a customer email to an ALREADY-SOLVED ticket sends nothing. Reopen is
  owner-only, so a member who adds an email to a solved ticket cannot trigger the
  "solved" email at all; only an owner can, by reopening and solving again.
  No "send now" button on purpose: build one only when this actually comes up.
- Changing a ticket's email never redirects an email already queued or failed:
  outgoing_emails.to_email keeps the address from solve time, and Retry uses it.
- Every escalation makes a ticket, including silent or abnormal calls. Expect noise
  (robocalls); filter by reason once real volume shows what to drop.
- Calls escalated before step 8 have no ticket (test data only, no backfill).
- Assignment emails (step 13) are best effort: sent right after the assignment is
  saved, not through the outbox table, so a failed send is only logged (no retry).
  There is no way to turn them off yet, and no in-app notification.
- Load counts only open tickets; it ignores ticket size, time off, or skill level.
- Tickets assigned before step 10 were marked "assigned by a person" by the
  migration (db/migrations/0009, hand-added UPDATE).

## Decisions log
- 2026-10-16: Dropped Supabase. Custom stack: Postgres + Drizzle + Better Auth + R2.
  Tenant isolation enforced in /db instead of RLS.
- 2026-10-16: Local Postgres in Docker for development, migrations in the repo.
- 2026-10-16: Email + password login.
- 2026-10-16: Teammate invites are their own step, right before ticket assignment.
- 2026-10-16: Rate limit counters in a Postgres table, no Redis for now.
- 2026-10-16: Own companies table. One user belongs to exactly one company via
  users.company_id. No Better Auth organization plugin.
- 2026-10-16: Teammate invites (step 3) start as copy-paste invite links, no email.
- 2026-10-16: Invites are tied to one email, 7 days, single use, revocable. The owner
  picks owner or member (default member). Only owners create or revoke invites.
- 2026-10-16: Category routing is its own step after auto-create (step 9). Step 4
  is manual assignment only.
- 2026-10-16: Anyone in the company can assign and solve tickets. Only owners can
  reopen. Reopen sets status open and clears solved_at and solved_by_user_id.
  Solving a reopened ticket again sends the customer another email (step 5).
- 2026-10-16: Customer emails use an outbox table (outgoing_emails) with a Retry
  button. No customer email on the ticket = no email, page says so.
- 2026-10-16: One shared EMAIL_FROM, company name as display name. If
  companies.reply_to_email is set it becomes the Reply-To (nothing sets it yet).
- 2026-10-16: Real email only when SEND_REAL_EMAIL=true. Default everywhere is
  writing emails to .dev-emails/.
- 2026-10-16: Vapi webhooks use HMAC. Defaults: SHA256, x-vapi-signature,
  x-vapi-timestamp, "{timestamp}.{body}", hex, seconds, 5 min window. Header
  names, algorithm, payload format, encoding, prefix and timestamp unit are env
  settings so Vapi's real format can be matched without code changes.
- 2026-10-16: Transcripts encrypted at rest with AES-256-GCM. Caller numbers stay
  plain (step 8 copies them onto tickets). Only end-of-call-report is handled.
- 2026-10-16: Read-only Calls page (list + transcript), company-scoped.
- 2026-10-16: The brain analyses finished calls (Vapi runs the live conversation).
  No custom-model mode. Model from ANTHROPIC_MODEL, starting at claude-sonnet-5-5,
  effort high. No refusal fallback: a refusal escalates. Without ANTHROPIC_API_KEY
  every call escalates ("model unavailable").
- 2026-10-16: Step 8: every "needs_human" (including rule cases) gets a ticket:
  subject from Claude's ticket_subject (or "Phone call needs follow-up"), plain-text
  summary, caller number as customer phone, linked to the call. No email
  extraction, no backfill of older calls.
- 2026-10-16: Build order: new step 9 "expert enters the customer's email on a
  ticket". Everything after shifted down by one: category routing is now step 10,
  first adapter 11, email channel 12, onboarding 13. (Older log entries keep the
  step numbers they had at the time.)
- 2026-10-16: Step 9: anyone in the company can set or change a ticket's customer
  email; who and when are recorded (tickets.customer_email_set_by_user_id / _at,
  same-company foreign key). No double entry (copy-paste defeats it): the form
  shows the cleaned-up address back ("Solved emails for this ticket will go to
  x@y.com. Correct?") and saves only on confirm. No auto-send, no "send now".
- 2026-10-16: Step 10: owners manage the category list (archive, never delete;
  renames follow through to tickets). Each person ticks their own categories;
  owners can change anyone's. Routing: fewest open assigned tickets, ties to whoever
  joined first. Manual category menu on the ticket page. Assignments record
  automatic vs manual, plus routing's original pick (routed_to_user_id).
- 2026-10-17: New build order for everything left (steps 11-20 above). The first
  adapter moved to the end because it is blocked on the first customer's vendor.
  Still one step at a time: plan, yes, build, test, commit. Proposed but NOT yet
  decided: Vercel for hosting (step 17), Resend Receiving for inbound email (step 15).
- 2026-10-17: Step 12: email verification required for every new account (owners
  and invited teammates). Accounts that existed before were marked verified by
  migration 0010 so nobody was locked out. Login of an unconfirmed account sends a
  fresh link; links work for one hour.
- 2026-10-17: Step 13: assignment emails to the assignee (best effort, after the
  save). Ticket subjects are cleaned of line breaks before going in a subject line.
