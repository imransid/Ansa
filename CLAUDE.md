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
- Never log API keys, tokens, phone numbers, or call transcripts
- All secrets in .env.local only. Never hardcode. Never commit .env
- Encrypt stored third-party OAuth tokens at rest
- Verify webhook signatures on every incoming webhook (Vapi, Resend)
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
9. First adapter (whichever vendor my first customer uses)
10. Email channel using the same brain
11. Company onboarding flow (connect software, upload docs to R2)

Do not jump ahead. Finish step N before starting step N+1.

## Known gaps (revisit later)
- No email verification yet: anyone can sign up with any email. Needs Resend (step 5).
  This also means an invite tied to an email only protects against people who
  don't know that email.
- An invite is marked used just before Better Auth saves the new user. If saving
  then fails, the invite is spent and the owner has to create a new one.
- Signup inserts the company before Better Auth inserts the user, in separate
  transactions. If the user insert fails, an empty company row is left behind.
- The IP used for rate limiting comes from x-forwarded-for. That header is only
  trustworthy behind a host that overwrites it (Vercel, Cloudflare). Check when hosting is picked.
- Old rate_limits rows are never deleted. Add a cleanup job when it matters.
- Ticket list has no pagination (50 cap). See TICKET_LIST_LIMIT in db/tickets.ts.
- Times are shown in UTC, not the viewer's local time (lib/format-date.ts).

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
