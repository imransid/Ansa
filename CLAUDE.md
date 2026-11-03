# Project: AI Voice Support Agent (SaaS)

## What we are building
A plug-and-play AI agent that replaces first-line human support.
It answers phone calls and emails for any company, solves what it can,
and creates a ticket for a human expert when it can't.

Since 2026-11-01 (the owner's direction): ansa is a representative that
answers for you when you can't, on every channel you give it. For a
business it answers the customers (questions, orders, problems it knows
the solution to). For one person it is their shadow: while they are away
(asleep, busy, offline) it answers what it can as "<name>'s AI assistant",
takes a note of the rest, and tells them what they missed when they're
back. It never pretends to be the person. Platform limits: a personal
WhatsApp number or Facebook profile can't be automated in an allowed way;
a person's channels are Telegram, email, phone calls forwarded to ansa's
number, and others with an official API.

## Flow
1. Customer calls -> AI answers, listens, understands
2. AI can solve -> answers on the call, done
3. AI cannot solve -> creates ticket with call notes
4. Ticket auto-assigned to the right human expert
5. Expert marks solved -> customer gets an automatic email
6. Email channel works the same way, same brain

## Stack
Three parts in one repository (the backend rewrite: approved 2026-11-01,
done on the laptop 2026-11-02; docs/backend/ documents it):
- Screens: Next.js (App Router, TypeScript), Tailwind + shadcn/ui. Pages and
  forms only: no database access; every read and write goes to core.
- core: Go 1.24 (core/, module ansa/core; pgx for Postgres). All the work
  and every security rule; the ONLY code that touches the database.
- brain: Python 3.14 (brain/, FastAPI). The AI thinking only (prompts and
  model calls); no database, no state.
- Postgres - local in Docker for development, Neon in production later
- Drizzle - only the schema (db/schema/) and its SQL migrations
  (db/migrations/), run with drizzle-kit (pnpm db:generate, pnpm db:migrate)
- Logins: core, in Better Auth's formats and tables (so every login made
  before the rewrite still works); the Better Auth library is gone
- Cloudflare R2 - file storage (call recordings, uploaded docs, media)
- Vapi - telephony, speech-to-text, text-to-speech
- Claude API - the AI model, called only by the brain
- Resend - email out and in, called only by core
- No Supabase.

## Architecture rules
- Three parts, nothing more: the screens (Next.js), core (Go) and the brain
  (Python); one core service and one brain service, no other services.
  docs/backend/README.md is the map; read docs/backend/security.md before
  changing core or the brain.
- Since the rewrite the rules below live in core and the brain. A file they
  name (services/..., db/<file>.ts, adapters/..., most lib/..., scripts/...,
  lib/auth.ts) is where the rule USED to live in the old TypeScript backend,
  deleted in Phase 8 (2026-11-02). The behaviour is the same unless a rule
  says otherwise: docs/backend/migration-plan.md maps each old file to its
  core or brain module, and docs/backend/modules/<module>.md describes it as
  it is now. The old `pnpm` operator and simulate scripts are core's `make`
  targets (core/README.md); "the daily job" and "/api/cron/publish" are
  core's own scheduler (docs/backend/modules/schedule.md); a webhook's
  "after()" is a job in core's queue (docs/backend/modules/jobs.md). "A
  check" in a rule meant the old checks (scripts/tenant-isolation/, deleted
  with the old backend): what guards the rule now is listed on its module's
  page (core's and the brain's tests) or in pnpm check:screens, and a rule
  listed in neither is guarded by review only.
- Multi-tenant. EVERY tenant table has company_id. EVERY query filters by it.
  - Exceptions: Better Auth's tables (sessions, accounts, verifications) are
    keyed by user, not company. rate_limits is keyed by an HMAC of the IP or
    address (a secret derived from BETTER_AUTH_SECRET), because limits apply
    before we know who you are. Every read across companies is listed, with
    why, in core/internal/database/CROSS_COMPANY.md and carries a
    `-- cross-company: <reason>` comment: due work claimed by core's workers
    and periodic tasks (jobs, the assistant's catch-up, the publishing
    queue, post numbers, "Post for me", stuck image requests, cleanup by
    age), the webhooks finding their company from what only ansa issues (a
    phone line, a forwarding address, a Stripe customer, a Telegram link
    code or the business connection it tied, a Facebook Page connected in
    exactly ONE company, a WhatsApp number connected in exactly ONE company
    or, when Meta ends or restores the link, its business account's
    numbers), a session cookie's person, an address at login,
    an invite's hash, and "is this platform account still connected
    anywhere" before X or Google revoke. Each returns ids only, and the work
    then continues through company-scoped paths with the row's own company.
    telegram_pending_connections belongs to no company: a Telegram account
    that added ansa's bot before its owner pressed Start with a code, kept
    an hour (Telegram's ids and the account's name, never a message) until
    the code names the company, then deleted by the cleanup.
- Tenant isolation lives in core (core/internal/database, core/internal/tenant).
  - There is no Row Level Security. Core is the only thing keeping one
    company's data away from another. Treat every change there that way.
  - Only core talks to the database. The screens never do (no pg, no
    drizzle-orm, nothing of @/db but @/db/schema's types); the brain never
    does.
  - Every core function that touches tenant data takes a tenant.CompanyID
    (never a plain string) as a required argument, filters by it in every
    WHERE, and sets it on every INSERT. core/internal/database/tenant_test.go
    reads every SQL statement in core and fails on one that names a tenant
    table without company_id, unless CROSS_COMPANY.md lists it.
  - The company always comes from the server side, never from the request:
    the login session core reads itself (core/internal/session), or for a
    webhook what only ansa issues (above). The screens never send a company,
    and core's API refuses unknown fields.
  - ESLint enforces the screens' side (eslint.config.mjs, .js/.mjs/.cjs files
    too): importing drizzle-orm, pg or anything under @/db except
    @/db/schema (types) is an error, and so are relative paths into db/,
    import() or require() of them, and run-time loading lint can't read
    (node:module/createRequire, module.require, a require kept in a
    variable); an import used only as a type says so. db/ (the schema and
    its migrations) and scripts/ (the screens' own checks) are exempt.
- Request flow: page / route handler / server action -> lib/core-views/<area>.ts
  -> lib/core-api.ts (signed with SCREENS_SHARED_SECRET, the person's login
  cookie passed on) -> core's API (/api/v1/..., core/internal/api) -> core's
  module -> Postgres. Webhooks go straight to core (/webhooks/<name>). Core
  asks the brain (signed with BRAIN_SHARED_SECRET) and checks every proposal
  before it reaches a customer.
- Auth (core/internal/accounts, docs/backend/modules/accounts.md): signup,
  invite joins, login, email confirmation, logout, password reset, name and
  password change and "log out on all other devices" are server actions that
  call core, which validates and rate limits them. Core reads and writes
  Better Auth's tables in Better Auth's formats (scrypt passwords, the signed
  session cookie, its links), so logins made before the rewrite still work;
  nothing else of Better Auth runs. The screens ask core who is logged in
  (GET /api/v1/me, lib/session.ts). Which company a new user joins is
  decided in ONE place, core's signup (a new company as owner, or the
  inviting company with the invited role, the invite claimed in the
  account's own transaction). Signup asks only for a name, an email and a
  password (step 45): a new owner's company is named "New business" until
  the setup's first step, and nothing in the signup request names a
  company.
- Invite links put the token after "#" so it never reaches the server or its logs.
  Only a SHA-256 hash of the token is stored.
- Email verification (step 12): no session until the address is confirmed
  (requireEmailVerification). The emailed link also uses "#<token>" (we ignore
  Better Auth's own "?token=" url); app/verify-email reads it in the browser and
  asks for the account's password. Only the link AND the password together confirm
  the address and log in (services/auth.ts, confirmEmailWithPassword). A link alone
  never confirms or logs in anyone: autoSignInAfterVerification is off, and nothing
  else may call verifyEmail (a check enforces it).
- Signup or joining with an address that already has an account changes nothing
  and answers exactly like a new signup ("check your email"); only the address is
  told, by a "you already have an account" email (onExistingUserSignUp). The join
  form checks the invite first, so a made-up invite can't tell the two apart.
  Verification and existing-account emails: at most 3 each per address per hour,
  skipped silently, and never with the name typed at signup.
- Password reset (step 22): the link uses "#<token>" (Better Auth's own url is
  ignored) and app/reset-password reads it in the browser. Only a SHA-256 hash of
  the token is stored (verification.storeIdentifier). Asking gets the same answer
  for every address, and the email goes out after the response
  (services/password-reset-email.ts), so timing doesn't tell who has an account.
  A link works once, for one hour (lib/link-lifetimes.ts, which the emails and
  pages that name the time read too), and ends every login of the account; a reset
  or a password change also voids the account's other links. A reset never
  confirms an address (that still needs link + password). Every account gets its
  link, but the service looks up whose link it is first: for an unconfirmed
  account that joined through an invite (the address may be a typo, or an owner's
  squat, and its inbox a stranger's) the link removes that account instead of
  setting a password, in one /db transaction that routes its open tickets again
  (services/unconfirmed-invitees.ts). At most 3 reset emails per address per hour.
- Logins last exactly 7 days (session.disableSessionRefresh: pages can't renew the
  cookie). Changing the password ends every other login. Login limits
  (services/login-limits.ts) count per IP (an IPv6 address counts as its /64
  network, lib/request-ip.ts), per address + IP, then per address across all IPs.
  A browser holding a signed "known device" cookie for that address (set by a
  login that worked, lib/known-device.ts) counts on its own counter instead of
  the per-address cap, so strangers filling that cap can't lock it out. A right
  password takes its attempt back (also on an unconfirmed account), so only
  failures add up. /login and /verify-email share them.
- Logged-out visitors (step 32): proxy.ts (Next.js 16's name for middleware)
  answers a page view (GET or HEAD) of an app section without a Better Auth
  session cookie with a 307 to /login?next=<path>. The sections are
  SIGNED_IN_SECTIONS (lib/login-redirect.ts); the proxy's matcher repeats them,
  and a check keeps both equal and every page that reads the session inside
  one. It only checks that the cookie exists (Better Auth's getSessionCookie),
  never the database: every page still calls requireSessionContext(<its own
  path>) and every action checks the session. A login follows next only to a
  path on this site (readSafeReturnPath: one "/", then not "/" or "\", and
  only printable ASCII after it: no space, backslash, control character or
  non-ASCII, which Next would write unencoded into a header Node refuses),
  else goes to /dashboard. /login and /signup send a valid session on
  (components/redirect-if-logged-in.tsx): a real session check, never the
  cookie, so an ended session's cookie can't bounce between /login and the app.
- Any column that points at a user (assignee, solver, ...) gets a composite foreign
  key (company_id, user_id) -> users(company_id, id), so Postgres itself refuses a
  user from another company. See db/schema/tickets.ts. drizzle-kit may write that
  foreign key before the unique constraint it needs: check the migration order.
- User ids from forms are only claims (and never hold a control character:
  Postgres refuses a NUL, lib/validation/control-characters.ts). Updates check
  them inside the same SQL statement (see db/ticket-updates.ts), never in a
  separate earlier read, and lock
  that person's row there (FOR SHARE), so a removal being saved at that moment is
  waited for and then seen. Saving someone's categories (db/user-categories.ts) locks
  their row ("no key update") and checks every category inside the INSERT that
  links it (active, same company, rows locked FOR SHARE): a short count rolls
  everything back. Setting a ticket's category while an owner renames it ends
  in a foreign key violation, answered "refused" (setTicketCategory).
- /db writes name every column (never a spread of a passed-in object), so an
  object carrying a companyId, status or ticket of its own can't write it.
- Who can take tickets (canTakeTickets, db/users.ts): people who confirmed their
  email and were not removed. Routing, manual assignment, the assignee menu,
  categories and assignment emails all use it.
- Team control (step 23, db/team-members.ts): only owners remove people and change
  roles, never their own, each in ONE transaction that first locks the company row
  ("no key update", the lock ticket numbering takes too), so two owners can't
  remove or demote each other at once and a company always keeps an active owner.
  Removing a confirmed teammate sets users.deactivated_at (the row stays, so
  tickets keep the name) and, in the same transaction, deletes their sessions,
  password, reset links and categories, revokes their pending invites,
  disconnects the LinkedIn profiles they connected (step 40: those post as
  them; Pages, channels and X accounts stay) and routes
  their open tickets again (db/teammate-access.ts; new assignees are emailed after
  commit). Making an owner a member revokes their pending invites and
  disconnects the LinkedIn profiles they connected too (step 41 review: those
  post as them, and a member can neither cancel a post nor disconnect one), in
  the same transaction (the log: the app's, "teammate_made_member"). Removing
  someone who never confirmed deletes the account instead
  (db/unconfirmed-accounts.ts), which frees the address.
- An invite is saved only while its creator is an active owner, checked with their
  row locked FOR SHARE in the same transaction (createInvite, db/invites.ts). An
  invite created at the moment its owner is removed or demoted is then refused,
  or saved first and revoked with the rest: nobody walks back in through it.
- A removed person is shut out everywhere: the session-create hook in lib/auth.ts
  gives them no session (login, the confirm page, a password change),
  lib/session-context.ts treats any session that survived as logged out, and no
  reset link is sent to or accepted for them.
- Routing (steps 10 and 29, db/routing.ts): a NEW ticket whose customer phone
  (compared by its digits, 7 or more, never a hidden caller's placeholder number:
  customerPhoneDigits in lib/phone-number.ts) or customer email matches an open
  ticket of the SAME company assigned to someone who can take tickets goes to
  that person (the newest such ticket's assignee), whatever its category
  (db/same-customer.ts). Otherwise every new ticket with a category, and every
  open unassigned ticket whose category is set, goes to the expert in the SAME
  company who handles that category, can take tickets, and has the fewest open
  tickets (ties: joined first), in the same transaction. When someone starts
  handling categories (replaceUserCategories) or an owner restores a category,
  that company's open unassigned tickets in them are routed in the same
  transaction. Routing never takes a ticket from someone and never routes a
  solved one; removing someone sends their open tickets back to it, and so does
  reopening a ticket whose assignee was removed. Every transaction that routes
  takes the company's row lock FIRST (lockCompanyRow, db/company-lock.ts; ticket
  numbering takes the same lock), so routings in one company run one at a time
  and two can't both pick the same "least busy" expert. Every assignment records
  how it happened: tickets.assigned_automatically (true =
  routed, by category or same customer; false = a person; null = unassigned) and
  tickets.routed_to_user_id (routing's first pick, never overwritten) so routing
  accuracy can be measured. Each routing also writes a "routed" history row with
  the category it followed (empty = same customer), step 30.
- Category names are owner-managed settings, sent to Claude with the transcript
  slice, one per line (so no line breaks or control characters in a name). At
  most ACTIVE_CATEGORIES_MAX (100, lib/form-limits.ts) active per company,
  checked under the company lock on create and restore; a person may tick them
  all. Claude may only answer with one of the company's active names, or "".
  Its pick is saved by category id (db/ticket-creation.ts reads the CURRENT name
  under FOR KEY SHARE in the ticket's transaction), so an owner renaming the
  category while Claude thinks is followed; archived meanwhile = no category.
- Email: core code only calls sendEmail() in lib/send-email.ts. It writes to
  .dev-emails/ (adapters/dev-email-outbox.ts) unless SEND_REAL_EMAIL is exactly
  "true", then it uses adapters/resend.ts. Never call Resend directly. A send
  gets 20 s (SEND_TIMEOUT_MS); running out is a failed delivery, "timeout" (safe
  to Retry: the row id is the idempotency key). A failed
  delivery is logged and stored as an error code only (Resend's code, a file
  error code: lib/delivery-error-code.ts), never the provider's message.
  Received email content comes through lib/inbound-email.ts on the same switch:
  Resend's Receiving API (adapters/resend.ts) when SEND_REAL_EMAIL is "true", else
  the .dev-inbound/ stand-in (adapters/dev-email-inbox.ts), both through one Zod
  schema. Account emails (confirm, already have an account, reset) come from
  "ansa" <EMAIL_FROM> (buildAccountEmailFromHeader). Customer
  and assignment emails come from "<Company> via ansa" <EMAIL_FROM>
  (buildFromHeader: the name NFKC-normalized so look-alikes like ＠ count, as one
  plain line, without @ " < > \ or the encoded-word markers =? ?=). The "solved"
  email is fixed text with the request number only (lib/emails/ticket-solved.ts):
  never the customer's name or the ticket subject, which a sender can write.
- Customer addresses (a ticket's customer email, a received email's sender, a
  company's support and reply-to addresses) use customerEmailSchema
  (lib/validation/customer-email.ts, step 27): the browser's type="email" rule,
  domain converted to ASCII (lib/email-address.ts, shared with the ticket page's
  confirm step), a dot in the domain, max 254. Team accounts keep the strict
  emailSchema.
- Webhooks (Vapi, Resend, Stripe, Telegram, Messenger, WhatsApp: services/vapi-webhook.ts, inbound-email-webhook.ts,
  stripe-webhook.ts, telegram-webhook.ts, messenger-webhook.ts; core/internal/whatsapp/webhook.go) always run in this order: size cap -> raw bytes -> signature +
  timestamp -> rate limit (logged when it refuses) -> JSON parse -> Zod -> save.
  Telegram signs nothing: its "signature" is setWebhook's secret_token,
  sent back in X-Telegram-Bot-Api-Secret-Token and compared in constant
  time (no timestamp: Telegram sends none), and a signed update ansa can't
  read is answered 200 (a refused one would hold back the bot's later ones).
  Stripe's signature is checked with webhooks.signature.verifyHeader, which parses
  nothing. A Stripe subscription is stored for the company our checkout named:
  only the checkout event (client_reference_id) gives a company its first billing
  row, so a subscription event about a Stripe customer no company owns yet is
  ignored (its metadata alone could name any company); if client_reference_id and
  the subscription's metadata disagree, nothing is stored; later events go to the
  company that owns the Stripe customer, never to another. A second live
  subscription for a company that has one (paid twice) is not stored and logs
  "Stripe webhook ignored: company already has another live subscription";
  Billing hides Subscribe while it says a payment is being confirmed. For calls the
  company comes from our phone_lines table, never from the payload. Only ansa's
  operator links phone lines (pnpm link:phone-line, unlink:phone-line before a
  number's first call): the numbers live in ansa's Vapi account. Operator
  scripts find a company only by a confirmed, active owner's address, print its
  name and change nothing without --yes (scripts/company-of-user.ts). Owners see their
  numbers read-only on Setup, each with its last call (step 24).
- Call brain (step 7): lib/call-brain/ holds the slice, prompt, output schema and
  guards; adapters/claude.ts is the ONLY file that talks to Anthropic's API
  (adapters/claude-code.ts runs the Claude Code program instead,
  development only, step 49), and its
  client never logs or traces (logLevel "off", openTelemetry false), so
  ANTHROPIC_LOG and the SDK's OpenTelemetry settings change nothing;
  services/call-analysis.ts runs it after the webhook responds (Next's after()).
  - adapters/claude.ts has one function per use, and adapters/claude-settings.ts
    one settings object per use (step 41 split them: the ~200-line rule), so
    tuning one never changes the other: askClaudeForCallDecision
    (CALL_DECISION_SETTINGS: effort high, 8,000 tokens, 60 s per try, 2
    retries), askClaudeForEmailTriage (EMAIL_TRIAGE_SETTINGS: effort medium,
    4,000 tokens, 45 s, 1 retry), and for the Co-Founder (step 36)
    askClaudeForOnboardingTurn (ONBOARDING_TURN_SETTINGS: effort low, 3,000
    tokens, 40 s, 1 retry) and askClaudeForFactSuggestions
    (FACT_SUGGESTION_SETTINGS: effort medium, 4,000 tokens, 45 s, 1 retry),
    (step 37) askClaudeForMarketingPlan (MARKETING_PLAN_SETTINGS: effort
    high, 16,000 tokens, one try of 270 s: a retry after a timeout could
    never finish inside the page's 300 s), and (step 38)
    askClaudeForContentDraft (CONTENT_DRAFT_SETTINGS: effort medium, 12,000
    tokens, 120 s, 1 retry), (step 41) askClaudeForCalendarPlan
    (CALENDAR_PLAN_SETTINGS: effort medium, 6,000 tokens, 90 s, 1 retry),
    and (step 42) askClaudeForPerformanceReview
    (PERFORMANCE_REVIEW_SETTINGS: effort medium, 8,000 tokens, 120 s, 1
    retry), and (step 46) askClaudeForMenuReading (MENU_READING_SETTINGS:
    effort low, 16,000 tokens, 120 s, 1 retry), the only use that sends an
    image (ModelRequest.image, the photo before the text), and (step 49)
    askClaudeForAssistantReply (ASSISTANT_REPLY_SETTINGS: effort low, 3,000
    tokens, 30 s, 1 retry) and (step 54) askClaudeForAutopost
    (AUTOPOST_SETTINGS: effort low, 3,000 tokens, 60 s, 1 retry), the only
    ones whose client may hold a restaurant's own key
    (services/assistant-engine.ts, assistantAskerFor with its use).
    Time limits and retries are set per request; timeout x tries plus the
    SDK's 8 s waits (longestRequestMs) must fit the routes' and pages' 300 s
    (a check enforces it), and each request is cut off there
    (an AbortSignal), however long a 429's retry-after asks to wait. The
    request/result types both share live in lib/model-request.ts (ModelAsker).
  - The slice (lib/call-brain/transcript-slice.ts): the first 4 and last 16
    turns, at most 8,000 characters; the oldest closing turns go first, never
    the last two. A turn over 1,300 characters keeps its first and last ~600,
    cut between words, with "[... N characters left out ...]" between. When
    the transcript has one turn per line, only a label at the start of a line
    changes speaker ("Customer:" inside a line is what someone said). Each turn
    is one line. Both slices (calls and emails) redact card-like and
    social-security-like numbers as "[number]" and email addresses as
    "[email]" (lib/redaction.ts), before any cut.
  - Claude never gets company, caller number or ids, has no tools, and its output
    has no company/call field. The service applies the decision to the call it asked about.
  - Anything missing, malformed, unexpected, refused, truncated or failed becomes
    "needs_human". "solved" needs ONE WHOLE sentence of the customer's
    (lib/call-brain/resolution-evidence.ts): equal to a whole sentence of one
    of the customer's last two turns after the 4 opening turns (a sentence ends
    at . ! ? before a space, but not after "Dr.", "e.g." and the like, nor
    before a word in small letters or a digit), at least 3 words, not a
    question (also one that lost its "?", also after a filler word: "has that
    fixed it", "Okay, is it fixed now", "..., right"), and not a sentence next
    to a "..." or a "[... left out ...]" marker (both count as cuts). Case,
    spacing, quote marks, apostrophes, NFKC forms and punctuation at the ends
    are ignored; nothing else. Claude's quote may be as long as a turn (1,300
    characters). Never add a path that defaults to "solved": a check allows
    "solved" to be set in decision.ts only.
  - A "needs_human" answer refused only for a field a little too long or a blank
    subject is kept, cut to fit (buildNeedsHumanSalvageSchema, reason
    "trimmed_output"); a "solved" answer never gets that second chance.
  - A failed request logs one fixed line, "Claude call failed: <class>"
    (lib/model-failure.ts); calls.ai_error_class keeps the class
    (a check allows a name only), and the call page and ticket show it. Reason
    codes and labels live in lib/call-brain/reasons.ts. The class is the
    SDK's own name for its errors (adapters/claude-errors.ts, by instanceof),
    never error.constructor.name: the production build minifies class names
    ("m"), found in step 38's run against `next start`.
  - Checks use fake models (ModelAsker) or a fake client. Never call the real API from checks.
  - Every "needs_human" creates a ticket in the SAME transaction as the decision
    (db/call-analysis.ts). tickets.call_id is unique (one ticket per call) and has
    a same-company foreign key. The ticket gets Claude's short summary in plain
    text; the transcript never goes on a ticket, it stays encrypted on the call.
  - A "solved" keeps the customer's confirming sentence as the transcript has it
    (findCustomerConfirmation), encrypted in calls.ai_evidence_encrypted
    (callEvidenceContext; a CHECK allows it on "solved" calls only), shown on the
    call page, never on a ticket.
  - "Escalate to a ticket" (step 31): anyone in the company, on a call decided
    "solved" with no ticket (services/call-escalation.ts -> db/call-escalation.ts).
    ONE transaction: an UPDATE claims the call (this company, decided, solved, not
    escalated, no ticket; the call row is locked before ticket numbering takes the
    company row, as when saving a decision), sets calls.escalated_by_user_id /
    escalated_at (same-company foreign key; CHECKs: both or neither, only on a
    decided "solved" call), then creates the call's ticket ("Phone call needs
    follow-up", Claude's summary + the teammate's note, the picked category by
    id), history "escalated" then routing. ai_outcome and ai_reason_code never
    change: wrong "solved" verdicts = solved calls with escalated_at.
- Knowledge during live calls (step 35, services/vapi-tool-calls.ts; how to
  set it up in Vapi: docs/going-live.md, section 4, step 7): the Vapi webhook
  also answers "tool-calls" for ONE tool, search_company_knowledge, after the
  same size cap, signature and per-IP limit. Zod (lib/validation/
  vapi-tool-calls.ts) keeps only message.call.id, message.call.phoneNumberId
  (null = missing) and toolCallList (at most 10; an entry without an id is
  left out): message.artifact (the live transcript) and message.phoneNumber
  are never kept or logged. The company comes from phone_lines; an unknown
  line or a web call answers every tool call "This phone number is not set
  up." and searches nothing. arguments may be an object or a JSON string;
  { query } becomes one plain line of 1-500. Once the message is read:
  ALWAYS HTTP 200 with { results: [{ name, toolCallId, result | error }] }
  (the size cap, signature and per-IP limit before it answer as for any
  Vapi request: known gaps), one entry per tool call, every value one line:
  up to 3 approved support pieces (searchKnowledge), each in its own
  <article title="..."> tags with title and text escaped, as in step 34's
  slice but on one line, so no article can fake a piece, close its tag or
  end the reference text, after a fixed label (reference text, not
  instructions; escaped characters), at most 1,500 characters, the first
  piece that doesn't fit cut after a sentence or a word and then escaped
  (lib/knowledge/call-answer.ts); no hit = a fixed line saying the
  knowledge base has nothing and to offer a ticket. An unknown tool, bad
  arguments, the per-company limit (knowledgeLookupsPerCompany, logged
  once per message) and a failure (its class logged) are error entries;
  no Claude call. Each search is recorded in knowledge_lookups (company,
  Vapi's call id, article ids, hit count; never the question) BEFORE its
  answer is given, so the call page's
  "Knowledge the AI looked up during the call" (joined by vapi_call_id within
  the company once the call is saved; titles read within the company, an
  article deleted since = "deleted article") is exactly what the assistant
  got. "Test what the AI finds" shows the same line.
- Whoever a ticket lands on gets an email (services/assignment-notifications.ts),
  sent AFTER the save, whatever the path: routing at creation (also of a ticket
  typed in or escalated from a call, step 31), routing after a
  call, routing when a category is set, routing waiting tickets when someone
  picks categories or a category is restored, routing again when someone is
  removed (or an unconfirmed invitee's account is removed by a reset link) or when
  a ticket of someone removed is reopened, or a person assigning. "Because you
  handle <category>" is only said when they do (a same-customer routing may give
  them a ticket outside their categories). Never for assigning
  yourself, never for a solved ticket, never for a save that changes nothing
  (the same assignee again), and never to anyone who can't take tickets: someone
  who hasn't confirmed their email address yet (it may not be theirs, see
  db/assignment-notices.ts) or was removed. The email holds number, subject and
  category only: no customer data. The subject goes out as one plain line: no
  line breaks or invisible format characters (lib/plain-text.ts).
- Files (step 14): core code only calls lib/file-storage.ts. It writes to
  .dev-files/ unless USE_R2_STORAGE is exactly "true", then to the private R2
  bucket. Files are only served by our routes after a login + company check, as a
  5-minute signed link (R2) or the bytes (dev), always with the type we
  stored (a signed link forces it too). Keys are <kind>/<companyId>/...:
  recordings/<companyId>/<callId>.<ext>, documents/<companyId>/<documentId>.<ext>
  and media/<companyId>/<assetId>.<ext> (step 39).
  Too many plays or downloads answer 429, never 404 (the services return
  "rate-limited"; lib/private-file-response.ts). Which documents are accepted
  (types, 4 MB) is lib/document-files.ts, checked in the browser before the
  upload is sent and again in services/documents.ts. The server reads a file's
  bytes itself (readPrivateFile) only to take a document's text into knowledge.
- Email channel (step 15): Resend's signed "email.received" webhook ->
  services/inbound-email-webhook.ts (same strict order as Vapi) -> the company's
  forwarding address decides the company (see the next rule) -> after the 200,
  services/inbound-email-processing.ts claims the email, fetches the content
  (lib/inbound-email.ts; Resend is tried 3 times on 429, 5xx or no answer, each
  try at most 20 seconds; a failure logs "Resend receiving fetch failed: <code>
  <status>", never Resend's message), never tickets mail from ansa's own
  addresses (EMAIL_FROM, anything on INBOUND_EMAIL_DOMAIN: "own_address", a
  loop, stopped before the filters and the fallback ticket, in every run, "Make
  a ticket anyway" included), skips (services/inbound-email-filters.ts) mail
  from the company's listed support addresses ("support_address", checked
  first; except when its own Google Group wrote its own address in From for
  DMARC: List-Id names that same address and one Reply-To names someone else),
  auto-replies (Auto-Submitted, X-Autoreply, X-Autorespond, Precedence:
  auto_reply, an empty Return-Path), bulk mail (Precedence bulk/junk/list,
  List-Id, List-Unsubscribe, except when List-Id names one of the company's
  support addresses: its own Google Group), bounces and floods (10/hour per
  sender; the sender is the Reply-To when there is one),
  lets Claude triage it (summary, subject, category: lib/email-triage, through
  askClaudeForEmailTriage; at most 100 an hour per company, then the ticket is
  made without Claude), and creates
  a ticket, only while the email is still being processed (its row is locked and
  checked before the ticket exists, db/inbound-email-processing.ts). Subject
  (max 1,000) and body (max 100,000, the cut marked) are stored encrypted on
  inbound_emails and shown on the ticket as "Original email" (or "could not be
  decrypted", never as an empty email). Without a plain-text part the body is
  text made from the HTML part (lib/html-to-text.ts, shown as text, Claude reads
  it too; an HTML part with no text says so on the ticket). Attachments are not
  stored: their count, and their file names encrypted, are shown ("2
  attachments not shown"); images the HTML shows inside the email ("cid:"
  references: logos, pasted pictures) are counted apart
  (inbound_emails.inline_image_count). Claude reads only what the customer
  wrote this time (lib/email-triage/own-text.ts, step 28): "> " lines and the
  "On ... wrote:" line above them go (also wrapped over 3 lines, also in de,
  fr, es, nl, pt, it; it must hold an address or a clock time), an unquoted
  earlier thread, an Outlook header block (From: with Sent:/Date: AND
  Subject: in the next 5 lines), a dashed "-----Original Message-----" /
  "---- Forwarded message ----" line (one of the words mail programs write
  there, or a From: line below it) or "Begin forwarded message:" cuts
  everything below it (Claude is told, "[Earlier or forwarded messages left
  out.]"), and a signature after a line of exactly "-- " (with its space)
  goes. When nothing the customer wrote comes before such a line (a bare
  forward, a contact form starting with From: and Date:), nothing is cut. Then
  the redaction above, at most 6,000 characters (the cut marked). Without a usable Claude
  answer the email's own subject becomes the ticket subject: one plain line,
  card numbers redacted (lib/card-numbers.ts, which the slices use too), at most 200
  characters. A missing or odd From never drops an email: the ticket just has
  no customer email (lib/mailbox.ts reads the last <...> group, unescapes
  quoted names, caps names at 200; the sender shown is one plain line, so a NUL
  or line break can't stop the save).
- Sender check (step 25): the sender becomes the ticket's customer email ONLY when
  Resend's own `authentication` result (receiving API, read with Zod in
  lib/inbound-email.ts) says DKIM or DMARC passed; SPF alone doesn't count.
  The raw From must also hold exactly one "@": Resend checks the From address as
  its parser reads it, and in "a@evil.com <b@bank.com>" that may not be the one
  parseMailbox takes (so "ana@x.com" <ana@x.com> is not verified either).
  Resend gives `from` as the bare address and the display name only in
  headers.from (services/inbound-email-sender.ts reads both): every From text
  must hold one "@" and both must name the same address. A From text over 2,000
  characters is read only at its end and never verified (the sender reader cuts
  it, after the schema kept it whole). When the email has one
  Reply-To that differs from From (contact forms, relays), neither address is
  filled in; the page suggests both (step 27). A Reply-To naming one of our own
  addresses (ansa's or a support address) is no Reply-To, and one of our own
  addresses is never filled in as the customer email.
  Never read Authentication-Results headers: anyone can write them. Otherwise
  (including a missing result) the ticket has no customer email, and the page
  shows the sender as "not verified" with "Use this address" (not on a ticket
  closed without emailing), which leads into the step 9 confirm.
  inbound_emails.sender_verified records the outcome.
- Forwarding addresses (step 24, lib/forwarding-address.ts): every company has
  exactly one, c-<companies.inbound_token>@INBOUND_EMAIL_DOMAIN (our Resend
  receiving subdomain, never EMAIL_FROM's domain; required when
  SEND_REAL_EMAIL=true, unset in development = inbound.ansa.test). Never change
  INBOUND_EMAIL_DOMAIN once companies forward to it: it is part of every
  forwarding address and of every Reply-To already sent, and only the current
  domain is read. The database makes the token (32 random hex characters,
  unique, format checked); nobody types or picks it, and only ansa's operator
  replaces it (pnpm replace:forwarding-address: a new database default, the old
  address stops at once). services/inbound-email-routing.ts looks for it in
  Resend's to, cc, bcc and received_for (safe to read from headers only because
  nobody else can make such an address) and takes the email only when exactly
  ONE company matches; otherwise it is ignored with a fixed log line, never given
  to the first match. Support addresses owners type (inbound_addresses, unique
  per company, never EMAIL_FROM or an address on INBOUND_EMAIL_DOMAIN) and
  EMAIL_FROM never decide the company: they are only shown on Setup and used to
  skip mail from the company itself. Never route on a typed address.
- Reply-To of customer emails: the company's reply-to address, else its
  forwarding address, so customer replies come back as that company's tickets
  (new ones: replies are not threaded, see Known gaps) instead of reaching our
  shared EMAIL_FROM.
- Nothing gets lost silently (step 27). Anything that fails after a received
  email's content arrived still saves one fallback ticket (fallback subject, no
  summary or category); only a database outage can stop an email from becoming
  a ticket, and then it stays "processing". A claim also takes an email still
  "processing" 15+ minutes after its run started (inbound_emails.
  processing_started_at; a check requires it). Every route or page whose work
  waits for Claude sets `export const maxDuration = 300` (both webhooks and,
  step 49, Telegram's, both
  scheduled jobs, the call page, the Emails page, the Co-Founder's Interview,
  Profile, Strategy, Calendar and Analytics pages, the content studio's new
  draft and draft pages, the media page, whose images are made after its
  answer, step 39, the queue page, whose posts go out after its answer,
  step 41, and the menu's read page, step 46). The scheduled job also runs
  stuck emails, calls and image requests (step 39) again (services/stuck-work.ts,
  through their normal company-scoped paths, least recently tried first,
  taking turns; db/stuck-work.ts is one of three cross-company reads, the
  publishing queue's claims, db/publish-runs.ts, and the post numbers'
  claims, db/post-metrics.ts, the others), starting one only
  while its slowest run (every Claude and Resend try timing out, plus the
  assignment email: LONGEST_CALL_MS / LONGEST_EMAIL_MS; an image service's
  budget, download and save: LONGEST_GENERATION_MS) still ends inside the
  300 s counted from the start of the job, the posts and cleanup before it
  included: the publishing queue's due posts go first (step 41: a run
  starts one only in its first ~30 s), then the cleanup, then this. The
  Emails page (/emails) lists every received email of the company (who, when,
  what became of it, never the content) with "Process again" (content
  unavailable, processing error, stuck) and "Make a ticket anyway" (filtered
  mail, mail from a support address included; never own_address), plus
  "Customer emails not delivered" (failed, not
  sent, bounced, suppressed or failed at Resend, current solves only), which
  the dashboard counts. The Calls list says "Stuck: analyze now" for a call
  not decided 5+ minutes in. Resend's email.suppressed and email.failed events
  are delivery problems like bounces.
- Any URL the server fetches because a webhook or an outside service said so
  (recordings; an image service's results, step 39) must be https on an
  allowed host, checked again on every redirect, within one time limit
  (lib/allowed-host-download.ts; lib/recording-download.ts uses it).
  A URL a person typed (step 34, "Import a web page") only goes through
  lib/safe-fetch.ts (see Knowledge base).
- Sensitive text at rest (transcripts and the sentences quoted from them, email
  contents, ticket notes, Inbox chat messages (conversationMessageContext:
  company and message, step 47), social accounts' OAuth tokens and PKCE verifiers:
  socialTokenContext names company, connection and token kind,
  oauthPkceVerifierContext company and attempt, (step 49) a
  restaurant's own Claude API key: anthropicKeyContext, its company, and
  (step 52) an order's delivery address and the customer's notes:
  orderFieldContext, company, order and field, and (step 56) a WhatsApp
  number's access token: social.WhatsAppTokenContext, company and number,
  decrypted only in core/internal/social like every third-party token) goes through
  lib/encryption.ts with a context naming its company and record (an id from a
  form is lowercased first, as Postgres gives it back: analyzeCallSchema,
  inboundEmailIdSchema, ticketNoteSchema). Only full 16-byte GCM tags decrypt.
  Knowledge articles, business facts, marketing plans and content drafts are
  NOT encrypted, on purpose (see Knowledge base and Co-Founder), and neither
  are the media library's prompts and alt text, nor post numbers and
  performance reviews (step 42: the company's own marketing); the
  Co-Founder's interview messages are (onboardingMessageContext: company and
  message).
- Every customer email is first a row in outgoing_emails, written in the same
  transaction as the change that causes it, then delivered right after commit.
  A delivery first claims the row in ONE UPDATE (pending, failed, or "sending"
  for 10+ minutes -> sending; db/outgoing-email-delivery.ts), so two deliveries
  never both send; "failed" is only recorded over "sending" (and "sent" never
  over "pending"), so a late failure never undoes "sent". The row id is Resend's
  idempotency key, so a retry within 24 hours of the first try (first_attempt_at)
  never sends twice; from 23 hours on, the claim needs the person's "Send it
  again anyway?" confirmation.
  The ticket page offers no Retry while a delivery is under way. Delivery
  (deliverOutgoingEmail, services/customer-emails.ts) allows 300 customer emails
  a day per company (RATE_LIMITS.customerEmailsPerCompany, every attempt counts,
  solve and Retry); over it the row keeps its status, last_error becomes
  "daily_limit" so the ticket page says why next to Retry, and Retry works later.
  The solve itself reports success: the notice lives on the email row, not in a
  message that would outlive a later Retry.
- Closing a ticket (step 25, services/ticket-status.ts, db/ticket-solving.ts):
  "Mark as solved" emails the customer. With an address on file the page first
  says "This emails x@y.com that request #57 is solved."; the form sends the
  address the page showed ("" for none) and the solve's UPDATE requires the
  ticket to still have exactly it, so the email never goes to an address the
  person didn't see. "Close without emailing" (anyone in the company, offered on
  every open ticket, address or not) solves with tickets.solved_without_email =
  true and writes no outgoing_emails row; reopen clears it, and no email is ever
  delivered for a ticket closed that way. The ticket actions show only the
  message of the action that ran last.
- Ticket history (step 30, ticket_activity, db/ticket-activity.ts): internal notes
  plus one row per change (assigned, unassigned, routed, solved,
  closed_without_email, reopened, category_set, customer_email_set; step 31:
  created, escalated, subject_changed, customer_name_changed), written by
  the /db function that makes the change, in the SAME transaction, with who did
  it (actor empty = routing or the app itself, like taking tickets off someone
  removed) and who it was about; same-company foreign keys on the ticket, actor
  and target. Assigning and setting the category take the company lock, then
  lock the ticket row, and return "unchanged" for the value the ticket already
  has: nothing is written, flipped to "assigned by a person" or emailed. The
  one exception: re-saving the category of an open, unassigned ticket still
  routes it (how a ticket goes back to routing), writing only routing's row.
  Re-entering the same customer email is a change (it records who entered it
  last); the address itself stays out of the history. Notes: INSERT ... SELECT
  from the company's ticket (the ticket id is only a claim), 1-5000 characters
  (Zod; a line break counts once, as in the box, and is stored as \n), the
  ticket-changes limit, author from the session, encrypted with a context
  naming company, ticket (its id lowercased, as Postgres gives it back) and
  note; never emailed, never logged. Rows are never deleted; deleting a
  never-confirmed account clears its name from them.
  The ticket page shows the newest 200 entries, oldest first, words them in
  lib/ticket-history-text.ts, and has the note box.
- Tickets typed in by a person (step 31): "New ticket" on the dashboard
  (/tickets/new) -> services/manual-tickets.ts -> createManualTicket
  (db/ticket-creation.ts): the session's company, channel "manual", Zod
  (manualTicketSchema), the category by id (read under FOR KEY SHARE in the
  same transaction: renamed = followed, archived or another company's = none),
  a "created" history row before routing's, routing as for every new ticket,
  and whoever it picks emailed. A typed customer email needs the step 9 confirm
  ("Solved emails for this ticket will go to ...", customerEmailConfirmed) and
  is recorded as entered by its creator. New tickets and escalations share one
  limit: 30 per 10 minutes per person (ticket-creations).
- Ticket fields have ONE set of rules (lib/validation/ticket-fields.ts: subject
  one plain line of 1-200, description 1-10,000, name one plain line up to 200,
  phone up to 40) for the AI's tickets, "New ticket" and the ticket page's
  "Edit subject or customer name" (db/ticket-details.ts: anyone in the company,
  ticket row locked; only a field the person changed from what the editor
  opened with (originalSubject / originalCustomerName, kept as they were while
  it is open) is written, so a teammate's change to the other field stays; one
  history row per field written, who and when only).
  The browser forms take their limits from lib/ticket-limits.ts. Forms that must
  keep what was typed after an error send their action from onSubmit inside a
  transition (React empties a form after a <form action> runs).
- Other forms (step 32) get what was typed back from their action instead:
  FormErrors.values (withTypedValues, lib/form-result.ts, whole up to 2,000
  characters: a web page's address), shown again as the field's
  defaultValue. Never a password field (a check reads app/actions/).
  A <select> whose defaultValue can change also gets that value as its key:
  React applies a select's defaultValue only when it first renders, so the
  reset after the action would put back the option it first showed (a check
  reads every select). The member category checkboxes use the onSubmit way
  above instead, and so does every form holding a menu React controls
  (value=, step 38: the content studio's): React's reset never tells such a
  menu its default, so it would show its first option while the state keeps
  the pick, and the next submit sends what it shows (a check reads them,
  with the components around them). Account and team fields take their limits from
  lib/form-limits.ts, which the Zod schemas use too. Field errors are
  announced (role="alert") and tied to their field (aria-invalid,
  aria-describedby). Inline "Save" forms (reply-to, company name, category
  rename, a ticket's category, the Co-Founder's support-trends setting, an
  image's alt text)
  return a SaveState and say "Saved." until a field is changed again. Every destructive button (remove a support address
  or a teammate, delete a document, a knowledge article or an image, revoke an invite,
  start the Co-Founder's interview over, regenerate a draft whose text was
  changed by hand, cancel an image request, disconnect a social account;
  step 41: cancel a scheduled post, mark one as not published, retry one
  that needs attention, switch an auto-publish rule on, archive or
  regenerate a scheduled draft) asks first through
  components/confirm-button.tsx and shows its failure next to it.
- Failures we expect from outside services are a message on the page, not an
  error screen (step 32): storage refusing an upload or a delete
  (services/documents.ts; a delete removes the file first and the row second,
  so a failed delete keeps the document listed; services/media-library.ts
  the other way round, see Media library), and Stripe failing to open its
  pages (askStripeForPage, services/billing.ts). Billing has a third mode,
  "off": production with USE_STRIPE not "true", where the page only says
  billing isn't set up (no developer text, no simulate buttons). "Analyze now"
  says when nothing could be saved, or claiming the call failed (analyzeCall
  returns "failed"; "already analyzed" only when the claim found nothing). In
  production, pages and messages for customers' teams never name a server
  setting (development still names its stand-ins): those go in the server log
  ("Could not decrypt stored text: check DATA_ENCRYPTION_KEY").
- Knowledge base (step 34, /knowledge, one per company, shared later by the
  support AI and the Co-Founder): knowledge_articles (title one plain line
  1-200, body 1-20,000 with a line break counting once, kind faq / policy /
  product / guide / solution / document / website and status draft /
  approved / archived as CHECKs on the lists in lib/knowledge/kinds.ts,
  use_for_support default on, use_for_marketing default off, at most one
  source: a Setup document, a solved ticket or an https URL; creator, last
  changer and approver with same-company foreign keys; a CHECK: approved =
  approver and time set, a draft has none) and knowledge_chunks (whole
  paragraphs packed up to 1,500 characters, lib/knowledge/chunking.ts,
  heading = the title, rewritten in the SAME transaction as every change to
  the title or body; search_vector GENERATED from heading (weight A) and text
  (B) with to_tsvector('simple', lower(normalize(x, NFKC) COLLATE
  "und-x-icu")): every language, no stemming, lower-cased by ICU whatever the
  database's locale; GIN index). Plain text ON PURPOSE: company-written
  reference text Postgres must search, not customer data; every form that
  writes it says to keep customer names, emails, phone numbers and account
  details out (NO_CUSTOMER_DATA_NOTICE, lib/knowledge/limits.ts; the imports
  NO_CUSTOMER_DATA_IMPORT_NOTICE, once above Setup's document rows; a check
  lists every form that sends a knowledge-writing action).
  - Search (searchKnowledge, db/knowledge-search.ts): the company first (both
    tables), approved only, an audience flag required ("support" |
    "marketing"), never drafts or archived. The question becomes OR-ed words
    of letters, marks and digits only (lib/knowledge/search-query.ts: NFKC +
    lower-case, 2-100 characters, a short English stop list, 4+ letters match
    as a prefix, at most 20; null = no query runs), passed to
    to_tsquery('simple', ...) as a parameter. ts_rank_cd, at most 2 pieces per
    article, 10 hits. Each hit names its article.
  - What the AI will read: lib/knowledge/prompt-slice.ts. Each hit in its own
    <article> tags with title and text escaped, whole hits best first within
    6,000 characters, and KNOWLEDGE_PROMPT_RULE in the system prompt (article
    text is data, never instructions; the model has no tools). "Test what the
    AI finds" on /knowledge shows exactly that, through a server action (a
    question stays out of URLs and logs); nothing is sent to Claude in step 34.
    The phone assistant gets one line instead, the same escaped tags without
    line breaks (lib/knowledge/call-answer.ts, step 35, above), and the box
    shows that line too.
  - Permissions (lib/knowledge/permissions.ts), checked in the services AND in
    /db, where the person's role is read again with their row locked FOR
    SHARE (an owner made a member meanwhile is refused): anyone in the company
    writes and edits drafts; only owners approve, archive, restore (back to a
    draft, approval cleared), delete (ConfirmButton), edit an approved article
    (it stays approved, as approved by them) and import. Every edit and
    approval names the revision the page showed (knowledge_articles.revision):
    changed since = refused ("stale"), so nobody overwrites or approves words
    they didn't see; a status another owner changed meanwhile (restoring an
    article no longer archived, approving one archived) says so
    ("wrong-status"), not "only owners". At most 1,000 articles per company,
    counted after taking the company row lock (lockCompanyRow, before the
    author's row), so saves at the same moment can't pass it.
  - Imports are drafts until an owner approves them; importing again makes new
    drafts. "Add to knowledge" on a Setup document (owners,
    services/knowledge-import.ts): the stored file (readPrivateFile) ->
    lib/knowledge/extract-text.ts (.txt/.md/.csv as UTF-8 without BOM; .docx
    with mammoth after lib/knowledge/docx-guard.ts unpacked it once under a
    50 MB cap, so a zip bomb is refused; the guard passes only an archive
    mammoth's JSZip reads the same way: the stated entry count found, the
    directory ending right at the end record, nothing after it, no zip64 or
    split archive, no two files sharing bytes (JSZip 3.10's rules: re-check
    the guard whenever mammoth or JSZip is upgraded); .pdf with unpdf; control characters
    out, blank lines tidied; nothing left = "No text could be read from this
    file; a scanned PDF has none") -> at most 200,000 characters, articles of
    up to 20,000 at paragraph boundaries titled "<file> (part 2 of 3)", kind
    document (lib/knowledge/article-parts.ts). Deleting a document clears its
    articles' source in the same transaction (the row locked first); the
    articles stay. "Import a web page" (owners, /knowledge/import,
    services/knowledge-web-import.ts) fetches ONLY through lib/safe-fetch.ts:
    https on port 443, no user name or password, no cookies or credentials
    sent, the host resolved once and EVERY address public
    (lib/public-address.ts: private, loopback, link-local, shared,
    documentation, benchmark, multicast and reserved ranges, IPv4-mapped and
    NAT64 forms), the connection pinned to the checked addresses through
    node:https's lookup (no DNS rebinding), every redirect (at most 3) checked
    again, 10 s in all (then everything it opened is closed, and nothing is
    opened after, even when a DNS answer comes late), 2 MB, text/html or
    text/plain only; the resolver and
    the request function can be replaced, for the checks only. HTML ->
    lib/html-to-text.ts, title from <title> (found with only A-Z
    lower-cased, so positions stay put), else host + path, kind website,
    source_url. It logs one fixed line, "Knowledge web import failed:
    <code>", never the address.
  - Support: the ticket page's "Related knowledge" (its own <Suspense>) lists
    up to 3 approved support articles matching the subject and category name,
    one piece each, or one quiet line. A solved ticket offers "Save as
    knowledge" (/knowledge/new?fromTicket=<n>, title = the subject, kind
    solution, the body empty with "Write the fix in general terms..."): the
    number is only a claim, and becomes source_ticket_id inside the INSERT's
    transaction only for a solved ticket of the session's company.
  - Rate limits (RATE_LIMITS): knowledge-writes per person, knowledge-imports
    per company per hour, knowledge-test-searches per person per minute,
    knowledge-lookups (the live calls' searches, step 35) per company per
    minute.
- Co-Founder: business profile and interview (step 36, /cofounder: Overview,
  Interview, Profile; its own links below the header, lib/cofounder/pages.ts).
  business_facts: one row per company and topic (unique), the 25 topics with
  label, group, key fact or not and a fixed question in lib/business-facts.ts
  (16 key facts; the code is the source: a check keeps the topic CHECK and the
  source CHECKs equal to its lists). A confirmed value (1-2,000, who, when,
  source interview / owner / knowledge, all or nothing) and BESIDE it a
  proposal (value, source interview / knowledge, when). A proposal NEVER
  overwrites a confirmed value; one equal to the confirmed value or to the
  waiting proposal writes nothing, and a newer one replaces the waiting one
  (db/business-fact-proposals.ts, rows written in topic order). Plain text ON
  PURPOSE, like knowledge: the company's own information about itself, which
  every later Co-Founder step reads; the forms say to keep customers'
  details out. Only owners change it (lib/cofounder/permissions.ts, checked in
  the services AND in /db with the role read again FOR SHARE): Confirm (the
  proposal shown, source kept), Edit and confirm (source owner once the text
  changed), Dismiss, and
  Edit / Fill in (source owner, confirmed at once; typing what waits clears
  it). Each names what the page showed (shownProposal; Confirm and Edit and
  confirm also shownConfirmedValue, the fact beside the proposal; Edit
  originalValue): changed meanwhile = refused ("stale"), also two first saves
  at once. Members read.
  The completion ("12 of 16 key facts confirmed") counts confirmed key facts
  only (lib/cofounder/profile-status.ts); the Overview's next steps follow it
  (confirm proposals, start / continue the interview, review the profile).
  - onboarding_messages (company, author assistant / owner, author_user_id
    with a same-company foreign key, body encrypted with
    onboardingMessageContext, ends_interview, created_at by clock_timestamp()
    so a question and its answer keep their order). Resumable: the page shows
    the newest 100, oldest first. Start over (owners, ConfirmButton) deletes
    the messages, never the facts. The first question is fixed text (no
    Claude call), saved with the first answer as the page showed it (the
    form names its topic, openingTopic); an answer to a conversation started
    over meanwhile is refused.
  - Each answer (owners, 1-4,000 characters, onboarding-turns: 60 an hour per
    company) is saved first, then services/onboarding-turn.ts asks
    askClaudeForOnboardingTurn with the topics and their status (<topics>,
    values cut to 300) and the newest 12 messages (<conversation>, the
    newest whole, older ones cut to 1,000; a cut never splits an emoji, as
    the API refuses half of one), every value escaped, card-like and
    social-security-like numbers as "[number]" (email addresses stay: the
    business's own is a fact), nothing about the account (lib/cofounder/
    interview-prompt.ts, prompt-text.ts). Output (JSON schema + Zod, strict):
    proposed_facts [{ topic (enum), value }], next_question, interview_complete.
    Unknown topics, empty values and odd entries drop one by one, values are
    cleaned and cut to 2,000, the question becomes one plain line of at most
    500 (lib/cofounder/interview-turn.ts, fact-proposals.ts). The proposals
    and the reply are saved in ONE transaction, only while the answer still
    exists. Every answer, reply and Start over takes the company row lock
    first (lockCompanyRow), so they run one at a time: Start over never
    leaves behind an answer or a reply saved at that moment (a lock on the
    answer alone did: the DELETE waited, but didn't see the new reply).
    Claude may end the interview only when no key topic is missing counting
    its proposals; otherwise the fixed question of the missing one is asked
    (lib/cofounder/interview-reply.ts). The pages call it finished only while
    no key topic is missing (a key proposal dismissed after the closing
    message opens it again). Without a usable answer (no key, refused, failed,
    cut off, malformed) the answer stays saved, nothing is proposed, and the
    reply is COULD_NOT_READ_NOTE plus the fixed question of the first key topic
    with neither value nor proposal; the page says so and links that topic on
    the Profile page.
  - "Suggest facts from knowledge" (owners, Profile page, fact-suggestions: 20
    an hour per company): the owner picks an approved article of the company
    ticked for support or marketing (either: nothing counts until an owner
    confirms; the menu lists all of them, up to the 1,000-article cap),
    Claude (askClaudeForFactSuggestions) reads its first whole pieces, at
    most 10,000 characters in step 34's escaped <article> tags, with the
    topics, and proposes facts for missing or different topics (source
    knowledge). Drafts, archived articles, ones ticked for neither (their
    page says nothing uses them) and other companies' articles are refused
    before Claude.
  - Confirming, editing, dismissing and Start over: business-profile-changes,
    120 per 10 minutes per person.
- Co-Founder: marketing strategy (step 37, /cofounder/strategy, each version
  at /cofounder/strategy/<n>). marketing_plans: one row per version (version
  1, 2, 3, ... unique per company, the next one taken under the company row
  lock with the maker's role read again FOR SHARE, db/marketing-plans.ts,
  never from a form), goal_note (the owner's note, 1-1,000, blank = null),
  plan (jsonb in the shape Claude writes, read back with the same schema),
  facts_used ([{ topic, value }]: the confirmed facts sent, as they were),
  knowledge_used (uuid[] of the articles whose pieces were sent, no foreign
  key: a deleted one shows as deleted), used_support_trends,
  performance_review_id (step 42: the review sent as past performance,
  same-company foreign key), created_by_user_id (same-company foreign
  key); CHECKs on the version, the note, the JSON types, 200,000
  characters and 10 articles. Plain JSON ON PURPOSE, like the facts it is
  made from. The newest version is the current
  plan; none is ever deleted. Only owners make plans and change the setting
  (canManageMarketingStrategy, checked in the services AND in /db); members
  read everything.
  - Making one (services/marketing-plan.ts, marketing-plans: 10 an hour per
    company, counted only once a plan can be made): Claude is never asked
    until "What the business does", "Products or services" (either one) and
    "Target customers" are confirmed (lib/marketing-plan/plan-readiness.ts;
    a proposal never counts); the page lists what is missing, each linked to
    its topic. The request (lib/marketing-plan/plan-prompt.ts,
    services/marketing-plan-inputs.ts) holds ONLY the confirmed facts, whole
    (<facts>, never a proposal), the keys of the unconfirmed topics, the
    approved articles ticked for marketing that match the products, services
    and goals facts (searchKnowledge with audience "marketing", the three
    taking turns at its 20 words, combineSearchTexts in
    lib/knowledge/search-query.ts, so a long products list can't leave the
    others out: never a draft, an archived or a support-only article; step
    34's escaped <article> slice, whole pieces within 6,000 characters), the
    owner's note (<goal_note>), the newest performance review (step 42,
    <past_performance>, lib/performance-review/past-performance.ts: its
    kept findings with the numbers they cite, each named by its post's
    topic or its group, its recommendations and limits) and, only while
    companies.cofounder_uses_support_trends is on (off by default; owners,
    on the Strategy page, settings-changes limit), <support_trends>: ticket
    counts per category name of the last 30 days (db/support-trends.ts
    selects the category and a count, nothing else of a ticket). Every value
    escaped; card-like and social-security-like numbers become [number] in
    the facts, the note and the review (its texts, and the topics and
    pillar names its numbers name, cut as the review's own request sent
    them: textForPrompt): articles and category names go as written, as
    in steps 34 and 36. Nothing about the account, no web
    research (IMPLEMENTATION_PLAN decision 10).
  - askClaudeForMarketingPlan; output (JSON schema + Zod, strict, no
    company, version or person field, lib/marketing-plan/plan-schema.ts):
    summary, audiences, positioning, goals, pillars (3-6), campaigns
    (platforms linkedin / facebook / x / youtube, lib/social-platforms.ts),
    cadence (posts per week more than 0, at most 14), statements [{ text,
    basis fact / assumption / suggestion, fact_topics }],
    missing_information, cautions. Texts become one plain line, cut at a word
    with "..." (never refused for their length); lists keep their first
    entries up to PLAN_LIST_LIMITS (lib/marketing-plan/limits.ts); blank
    entries, repeated platforms and cadences of 0 drop. Without what a plan
    needs (a summary, 3 pillars, ...) or in another shape it is unusable. A
    failed, refused, cut-off or unusable answer saves nothing: the page says
    so in plain words, and a failure logs "Claude call failed: <class>".
  - The fact rule (lib/marketing-plan/fact-basis.ts): a "fact" whose
    fact_topics are not ALL among the confirmed topics sent (none named, a
    proposal, an unconfirmed or unknown key) is stored as an assumption, and
    every statement keeps only topics that were sent. It runs again on each
    stored plan, against its own facts_used, when the plan is shown.
  - The page: the current plan (each main point's basis as a badge, with a
    legend), "Version n, made on <date> by <name> from N confirmed facts...",
    the note, "What this plan was made from" (the facts as they were, the
    articles, the trends or not), a notice when the confirmed facts changed
    since, "Make a new plan" (owners; maxDuration 300), the setting with
    exactly what it shares, and the newest 50 versions (a version's page
    links to the one before and after; an unknown number, or another
    company's, is its not-found.tsx). A stored plan this code can't read
    shows as such. The Overview names the current plan.
- Co-Founder: content studio (step 38, /cofounder/studio, /new, /<id>).
  content_drafts: one post for one platform and format (linkedin / facebook
  / x / youtube; post / image_post / video; both fixed when made), topic,
  the plan's pillar and campaign by name, title (YouTube only), body,
  hashtags (text[] without "#", at most 30 stored), call to action, image
  prompt (not on a text post), video script (video only), status idea /
  draft / approved / rejected / archived, and while the publishing queue
  has it scheduled / published / failed (step 41, below), version (1, +1
  on every change of content), generated_version
  (the version the AI last wrote), claims [{ text, supported, fact_topics }],
  facts_used, knowledge_used, plan_version (same-company foreign key to
  marketing_plans), approval (who, when, approved_version), the claims
  acknowledgment, the last rejection and its note, creator, last changer,
  planned_for (step 41). Same-company foreign keys on every person; CHECKs:
  the lists, the limits, YouTube takes video only, a title only on YouTube,
  a script only on a video, an idea holds nothing, approved = approver AND
  approved_version = version, no approval on idea / draft / rejected /
  archived, an acknowledgment only with an approval. Plain text ON PURPOSE,
  like the facts it is written from.
  - Platform rules: ONE pure file, lib/content-rules.ts (counting helpers in
    lib/content-studio/): what each platform takes; X 280 counted as X does
    (x-length.ts: twitter-text's weights, a link 23, an emoji 2;
    approximated, Known gaps); LinkedIn 3,000 and Facebook 63,206
    characters; YouTube a title of 1-100 and a description of 5,000 BYTES,
    no < or >; at most 10 hashtags (X warns above 2); an image post or a
    video needs its media (none can be attached before step 39); every
    confirmed "Words to avoid" word or phrase (split at commas, semicolons
    and lines; whole words, any case, in title, text, hashtags, call to
    action and script; "None." lists nothing) blocks. The limits count the
    published text: body, call to action, hashtags, each its own paragraph
    (composePublishedText), as the preview shows it. Issues are { code,
    severity blocking | warning, message }; the editor counts and checks in
    the browser with the same functions. Each text is searched once for all
    the words to avoid (a search normalizes it first), and X takes a link's
    closing punctuation off with a loop (a regular expression took seconds
    on a long run of dots); checks count the passes and time the link.
  - Texts (lib/content-studio/draft-text.ts, ONE cleaner for the editor's
    forms, the AI's answer and the editor's "anything to save?"): a line
    (topic, pillar, campaign, title, call to action) as toPlainSingleLine
    makes it but keeping the zero-width joiner and non-joiner and the emoji
    tag characters (emoji sequences, Persian spelling, Scotland's flag: a
    title and a call to action are published as written); several lines as
    \n, trimmed. At most 30 combining marks in a row (Unicode's stream-safe
    bound, UAX #15; the half-width sound marks U+FF9E/U+FF9F count, NFKC
    makes them marks), in every box: a person's longer run is refused, the
    AI's cut. WHY: normalizing (to count, to find the words to avoid) takes
    time growing with the square of a run's length; one run of 63,000
    marks held the server for seconds per check, for every company.
  - Generating (services/content-generation.ts, anyone; content-generations:
    30 an hour per company, counted only once the AI may write): not before
    what a plan needs is confirmed (plan-readiness.ts). The request
    (lib/content-studio/draft-prompt.ts, services/content-generation-inputs.ts)
    holds the platform's rules from lib/content-rules.ts, format, topic, the
    current plan's pillar and campaign when picked (by name: with their
    details while the plan has them), its positioning and audiences, ONLY
    the confirmed facts (step 37's <facts> block), the words to avoid and up
    to 4,000 characters of approved marketing articles matching topic,
    pillar and campaign; every value escaped, card-like numbers [number],
    nothing about the account. Output (JSON schema + Zod, strict: no
    "supported", company or draft field; more than 30 claims = unusable):
    title, body, hashtags, call_to_action, image_prompt, video_script,
    claims [{ text, fact_topics }], cleaned and cut to the columns, never to
    a platform's limit (that is a rule). A failed, refused, cut-off or
    unusable answer saves NOTHING (no new draft; a regenerated one keeps its
    text).
  - Claims (lib/content-studio/claims.ts, review.ts): THIS CODE marks a
    claim supported only when it names facts and every one was confirmed
    and sent; shown or approved later, each is checked again against
    facts_used and the facts now (one changed since = not backed). "I
    checked these claims" is needed when a claim isn't backed, or the text
    was changed or written by hand since the AI listed them
    (generated_version <> version), and is recorded with the approval.
  - Changes (services, then /db: the role read again FOR SHARE, the draft
    row FOR UPDATE): anyone writes (blank = an idea), edits (the version the
    editor opened; changed since = refused, never overwritten), regenerates
    (asks first when edited by hand; a page showing an older version is
    refused before Claude is asked; saved only while the version is still
    the one the page showed), archives (approval gone) and restores (a draft
    again, or an idea). Every change of content is a new version and clears
    the approval and the acknowledgment IN THE SAME UPDATE (and, step 41,
    cancels its waiting posts in the same transaction). Owners only
    (canReviewContentDrafts): approve the version they read (no blocking
    issue, the acknowledgment when needed, both checked on the stored row
    and the facts now, inside the transaction) and reject it (optional note,
    kept through edits until an approval). content-draft-changes: 120 per 10
    minutes per person.
  - Pages: the list (?status= current (all but archived) / idea / draft /
    approved / rejected / scheduled / published / failed (step 41) /
    archived and ?platform=, with counts, 50 a page),
    New draft (platform, the formats it takes, topic, the plan's pillars and
    campaigns; "Write it with the AI" or "Start blank"; maxDuration 300),
    and the draft (editor with live counts, issues and a preview cut where
    the platform's feed says "see more"; Approve, Reject, Regenerate and
    Archive wait while the editor holds unsaved changes (only what a save
    would change: the boxes compared as draft-text.ts cleans them,
    lib/content-studio/editor-values.ts, so a space at the end is none),
    and the editor holds still while one of them or a save runs
    (lib/report-pending.ts), so nothing typed is lost to the version it
    brings; the claims; what the AI wrote it from; maxDuration 300). New
    draft and the editor send their action from onSubmit (the menus rule
    above). A refused approval refreshes the page too: the approval reviews
    the facts as they are now, so a fact or word to avoid changed since the
    page loaded then shows, with the "I checked these claims" box when it
    is needed. An unknown or another company's draft is its not-found.tsx.
- Co-Founder: media library (step 39, /cofounder/media; everyone in the
  company uploads, describes, deletes and asks for images, as in the studio).
  media_assets: kind image / video, source upload / generated, content type
  (png, jpeg, webp, gif, mp4 only, from the file's own first bytes), size,
  width and height when the header states them, as shown (a JPEG turned by
  its Exif orientation: lib/media/dimensions.ts, jpeg-orientation.ts),
  storage_key (a CHECK allows only media/<companyId>/<assetId>.<ext>), the
  upload's name (one plain line), alt text (one line, 0-1,000), and for a
  generated one its job and provider; same-company foreign keys on the
  creator and the job. media_generation_jobs: kind, prompt (1-2,000), the
  provider asked, status queued / running / succeeded / failed / canceled,
  attempts (0-3), last_error (a CODE, lib/media/error-codes.ts; a CHECK
  refuses anything else), the service's job id, cost_cents (null =
  unknown), asset_id (same company; only on succeeded), asset_deleted_at,
  draft_id (same company) with draft_version (the version it was asked
  at), requester. CHECKs: failed <=> a code; succeeded <=> an asset (or one
  deleted since); queued = never started; a draft <=> its version. A unique
  index allows one open (queued or running) request per draft.
  - Uploads (services/media-library.ts): the name's type AND the file's
    first bytes (lib/media/signatures.ts: PNG, JPEG FF D8 FF, GIF87a/89a,
    RIFF....WEBP, "ftyp" at byte 4 but not a HEIF/AVIF still) must agree
    (lib/media/files.ts, the same check in the browser before sending and
    on the server); no SVG; 4 MB (Vercel's limit, as documents);
    media-uploads 30 per 10 minutes per person; 300 files and 500 MB per
    company, uploads and generated ones together: checked before each
    upload (two at once can pass by one) and before each request, with the
    requests still waiting or being made counted as files (each will be
    one); a generated file is checked again, size and all, when it is
    saved, under the company row lock: a full library fails the job
    "library_full", the file removed, never kept.
  - Serving: /api/media/<id> (login + company check, media-views 1,000 per
    10 minutes per person, 429 never 404): a 5-minute signed link, or the
    bytes inline with the stored type, nosniff and a sandbox CSP
    (inlineMediaResponse). Pages show them unoptimized (next/image's
    optimizer would fetch without the login).
  - Generation (lib/media-generation.ts, the ONLY door; one adapter per
    service, MediaProvider: start -> the file or a job id; poll -> running /
    done (bytes or an https URL) / failed (a code)). MEDIA_PROVIDER: unset in
    development = the stand-in (adapters/dev-media-generator.ts: a real
    1024 x 1024 PNG in one colour from the prompt's hash; no video:
    "no_video_provider"); production refuses the stand-in, so generation is
    "off" there (pages say it isn't set up, nothing is saved) until a real
    service is chosen (OPEN, IMPLEMENTATION_PLAN.md decision 9). A request
    (services/media-generation-jobs.ts; media-generations 30 a day per
    company) is saved queued, then run after the answer (after(); the media
    and draft pages have maxDuration 300) and by the daily job when stuck
    (queued 2+ minutes, running 15+). "Start now" on the page CLAIMS it
    before answering and hands only the service's work to after(): the
    page the action sends back is rendered before after() runs, and must
    show it being made (refreshing itself; a draft's editor waiting), not
    stuck again (services/media-generation-control.ts, with Cancel).
    A run (services/media-generation-runs.ts) CLAIMS the job in ONE UPDATE
    (queued, or running 15+ minutes with attempts < 3; past that, failed
    "interrupted"), refuses a job whose provider isn't this server's (a
    stand-in's job never runs in production: "provider_unavailable"), keeps
    the service's job id before polling (a later run polls, never asks
    again), fetches a result URL at once (lib/allowed-host-download.ts, the
    service's own hosts; one over 100 MB, stated or counted, is
    "output_too_large", services/media-generation-output.ts), keeps it only
    when its BYTES are an accepted type
    of the kind asked, stores it, then saves the asset, the job succeeded
    and the draft's attachment in ONE transaction (every write names the
    attempt it claimed: a run that lost its claim writes nothing). Anything
    else ends the job failed with a code, never an asset. Cancel: queued
    only. Logs: codes and class names only, never the prompt, an address
    or a key.
  - Drafts: content_drafts.media_asset_id (same-company foreign key; a CHECK
    keeps it off text posts and ideas). A post with an image takes an
    image, a video a video (db/content-draft-media.ts, in the transaction).
    Attaching or taking it off is a change of content: the next version,
    the approval cleared, an idea a draft (statusAfterContentChange counts
    media); the rules now see it (media_missing). It is no change of the
    TEXT: generated_version comes along when the text was the AI's
    (generatedVersionAfterMediaChange, db/content-draft-rows.ts), so a post
    the AI wrote keeps its claims current (no tick, Regenerate doesn't ask;
    every change of media does so, the library's too). "Make the image with
    the AI" (a post with an image only) uses the SAVED image description at
    the version the page showed (db/media-generation-requests.ts, the draft
    row locked: one open request per draft; a new one over a stuck one ends
    it "superseded", so it never runs); the result is attached when made,
    only while the draft is editable AND still at that version
    (media_generation_jobs.draft_version: a request stuck for hours never
    replaces what was edited, attached or approved since; changed or
    archived meanwhile = kept in the library, not attached). The editor
    waits while an image for the version on screen is being made (the page
    refreshes itself); one that failed says why on the draft's page.
  - Alt text (db/media-alt-text.ts) is published with the file (step 41),
    so changing it is a change of content of every draft using it: the
    next version, without its approval (approved = a draft again; archived
    stay archived), in ONE transaction; refused while a draft that is
    scheduled, published or failed to publish uses it
    (STATUSES_KEEPING_ALT_TEXT, the message names them). The rules look for
    the words to avoid in it too (lib/content-rules.ts, AttachedMedia).
  - Deleting (services/media-deletion.ts -> db/media-asset-deletion.ts):
    refused while a draft that is approved, scheduled, published or failed
    uses it (STATUSES_KEEPING_MEDIA; the message names the drafts);
    otherwise, in ONE transaction, its other
    drafts lose it as their next version (archived stay archived), its job
    stays succeeded with asset_deleted_at, and the row goes; the file goes
    after the row (a failed file delete is only logged, "Media file delete
    failed"). Lock order: the person, the asset, every draft using it, then
    jobs (delete; alt text the same, without jobs); the person, the asset
    FOR KEY SHARE, the draft (attach); the person, the draft, its requests
    (a request from a draft); the company row, the person, the draft, the
    job (a generation's save). An approval only reads the asset: a delete
    or an alt text change must lock its drafts first.
  - Every generated asset shows "AI-generated" (and "Development stand-in")
    wherever it shows: the library, a draft's media, its picker and preview
    (a check reads every file showing one). Links to an asset's card name
    the library page that shows it (lib/media/library-link.ts).
- Co-Founder: social accounts (step 40, /cofounder/accounts; owners connect
  and disconnect, members read: canManageSocialAccounts, checked in the
  services AND in /db with the role read again FOR SHARE). social_connections:
  platform linkedin / facebook / x / youtube, the platform's account id
  (unique per company and platform: reconnecting updates that row, same
  id), display_name (one plain line, 1-200), account_kind member / page /
  channel / account (a CHECK ties it to the platform), scopes (as granted,
  at most 50), the tokens ENCRYPTED (socialTokenContext: company,
  connection, kind), their expiries (null = none given), status connected /
  needs_reauth / disconnected (CHECKs: connected = a token; needs_reauth =
  a reason; disconnected = no token, no expiry, disconnected_at),
  last_error (a CODE, lib/social-errors.ts), connected_by (same-company
  foreign key), is_stand_in (= the account id "dev:stand-in", a CHECK),
  renewal_started_at (the renewal claim below; only on a connected row, a
  CHECK). No page, log, address or error ever holds a token: the page's
  list selects none (db/social-connections.ts), and only
  services/social-tokens.ts (before a platform call) and
  services/social-disconnect.ts (the revoke) decrypt one (a check).
  - Platforms: lib/social-platforms.ts (pure: kinds, statuses, setting
    names, the formats ansa publishes, PUBLISHED_FORMATS, and per platform
    its media, scheduling, metrics and access blocker); text limits come
    from lib/content-rules.ts. Mode per platform (lib/social-mode.ts, like
    Billing's): "real" with both settings of ansa's app (LINKEDIN_CLIENT_ID /
    _SECRET, FACEBOOK_APP_ID / _SECRET, X_CLIENT_ID / _SECRET,
    GOOGLE_CLIENT_ID / _SECRET; one without the other stops the server),
    "stand-in" in development without them, "not-set-up" in production
    without them (the page says "Not set up by ansa yet" and names no
    setting; development names them and the access blocker, for ansa's
    operator). lib/social-publishing.ts is the ONLY door core code uses:
    buildAuthorizeUrl, completeAuthorization, refreshIfNeeded (the decision
    and the call; services save), publishPost (published / not_created /
    unclear, lib/social-types.ts), fetchPostMetrics (step 42, below),
    revokeAccess. Adapters: adapters/linkedin.ts + linkedin-posts.ts,
    facebook.ts + facebook-posts.ts + facebook-graph.ts + facebook-metrics.ts,
    x.ts + x-posts.ts + x-metrics.ts, youtube.ts + youtube-videos.ts +
    youtube-metrics.ts (a file per job: the ~200-line rule),
    dev-social.ts. Every request goes through lib/social-http.ts
    (sendToPlatform: its own time limit, 15 s for API calls, 60 s for an
    image, 180 s for a YouTube video; redirect "manual", never cached;
    answers read capped at 1 MB through Zod, only the fields used), takes a
    fetch the checks fake, and maps errors to codes as the research's "not
    created" / "unclear" lists say; a platform's words are never kept or
    logged (a 422 is read only to tell a duplicate). A token is only ever
    sent to the platform's own hosts: an upload or session address it
    names elsewhere is refused (upload_url_refused). Text-only YouTube
    posts are refused before any request; LinkedIn, Facebook and X videos
    too (video_not_supported: their upload flows aren't built).
  - Connect (services/social-connect.ts, owners, social-accounts 30 per 10
    minutes per person, every start and return counted): an attempt row in
    oauth_states (only the state's SHA-256 hash; 32 random bytes in the
    redirect; a PKCE verifier, X and YouTube only (a CHECK), encrypted with
    oauthPkceVerifierContext; 10 minutes; the owner's role read again FOR
    SHARE), then redirect() to the platform. The callback
    (GET /api/social/<platform>/callback, thin, maxDuration 90,
    services/social-oauth-callback.ts): no session = /login?next=/cofounder/
    accounts; the limit; the state CLAIMED in ONE UPDATE (this person,
    company and platform, unused, unexpired: two returns with one state =
    one connection), then the platform's error (denied / provider_error), a
    missing code, the role, the mode; the code exchanged; the accounts
    saved (services/social-account-saving.ts: each token encrypted for its
    connection's id; an INSERT ... ON CONFLICT that updates only the row of
    that id, else the save is tried again with the ids there now). Always a
    303 to /cofounder/accounts?result=<code>&platform=<p>[&count=n], never
    a token, code, state or the platform's text; the page shows only known
    codes (accountsPageResultSchema); connecting a stand-in or disconnecting
    opens the page again at that address alone (redirect, "replace"), so an
    old result never sits above what changed. Facebook: code -> short-lived
    -> long-lived user token -> /me/permissions (all three permissions
    ticked, else missing_permission) -> /me/accounts: one connection per
    Page with CREATE_CONTENT, each with its Page token (no expiry; the user
    token is never kept); every Graph call with a token carries
    appsecret_proof. Stand-in (adapters/dev-social.ts): "Connect a stand-in
    account" (no consent screen, development and no app only), publishing
    writes .dev-social/<platform>/<time>-<id>.json (the post; a file only by
    kind, type, size and alt text) and answers "published", url null;
    production refuses both, whatever is set (standInsAllowed).
  - Disconnect (services/social-disconnect.ts, owners, ConfirmButton): ONE
    transaction removes the tokens and keeps the row (status disconnected);
    after the answer (after()) X and Google (REVOKES_ON_REQUEST,
    lib/social-platforms.ts, which the confirm question reads; a check ties
    it to the adapters) are asked to revoke (best effort, one fixed log line
    when they don't), but only once no connection of that account anywhere
    still holds tokens (db/social-account-connected.ts, above: another
    company's, or this one's made again): the last company to disconnect
    it has it revoked; LinkedIn and Facebook Pages offer no revoke with
    what ansa keeps (the confirm question says where to remove ansa).
  - Before any platform call (steps 41-42), prepareConnectionForUse
    (services/social-tokens.ts): a token running out within 5 minutes is
    renewed where the platform allows (X, Google; LinkedIn only for its
    partners), by ONE run at a time: right before asking the platform, the
    run claims the renewal in one UPDATE (renewal_started_at; a claim over
    a minute old is a dead run's and is taken over), since X may refuse a
    refresh token once it was used; another run waits for the new tokens
    (1 s at a time, 20 looks, then "try again later"), even with minutes
    left (a publish may take longer). The new tokens are saved in ONE
    UPDATE that names the access token it replaces
    (db/social-connection-tokens.ts: a disconnect, a reconnect or another
    renewal meanwhile wins, and the newest token is used); every write and
    a reconnect end the claim. A refused renewal = needs_reauth with a
    code; no answer = still connected, the code noted (refresh_unavailable);
    past its end with nothing to renew it (a LinkedIn token after its 60
    days, a refresh token after its own end, e.g. Google's 7 days in
    Testing) = needs_reauth token_expired / refresh_expired, and the page
    shows that even before anything tried (services/social-accounts.ts
    works out each access's lifetime as of now; "ran out on" only for a
    date that passed); an unreadable token changes nothing (the key is the
    fix). The tokens are read under the id Postgres gives back, whatever
    case the caller wrote it in.
- Co-Founder: publishing queue, calendar and activity log (step 41;
  /cofounder/queue, /cofounder/calendar and a draft's Publish section;
  owners act, members read: canManagePublishing, canPlanContentCalendar,
  checked in the services AND in /db with the role read again FOR SHARE).
  publish_jobs: one post of one draft to one account (same-company foreign
  keys on the draft, the account, the rule and every person), scheduled_for
  (UTC; "now" = the database's clock), status queued / publishing /
  published / failed / canceled / needs_attention, approval_mode owner /
  auto_rule (a rule id exactly on auto_rule, a CHECK), approved_version (the
  draft version it may publish), attempts (0-5), run_after (the next try),
  claimed_at, claim_id (new at every claim), external_post_id /
  external_url (https; only on published),
  last_error (a CODE, lib/publishing/job-errors.ts), published_at, creator,
  canceler. A partial unique index keeps one post per draft and account
  while queued, publishing, published or needs_attention (a failed or
  canceled one leaves room). autopublish_rules: platform, pillar ("" =
  any; one per platform and lower(pillar)), enabled (default false; who
  and when switched it on, a CHECK). cofounder_activity: actor (empty = the
  app), action (lib/publishing/activity-actions.ts, a CHECK), draft / job /
  account / rule / plan version (same-company foreign keys), code,
  clock_timestamp(): written by the /db function that makes the change, IN
  ITS TRANSACTION (connected, disconnected (a teammate's removal or an
  owner made a member: the app, "teammate_removed" / "teammate_made_member"),
  reconnect_needed, draft approved / rejected /
  changed_after_approval / archived / restored, idea_planned, scheduled
  ("auto_rule" for a rule's), canceled (why: draft_changed / _rejected /
  _archived), publish_now, published, publish_failed, publish_delayed,
  needs_attention, marked_published / _not_published, retried, rule_*,
  plan_created); never a token or a post's text.
  - Scheduling (db/publish-scheduling.ts, ONE transaction: the person, the
    draft FOR UPDATE, then lib/publishing/schedule-check.ts on what
    db/publish-schedule-context.ts reads, the approver, the rule, the
    accounts and the people behind them FOR SHARE): the version the page
    showed; an idea, a rejected or an archived draft never; a format
    PUBLISHED_FORMATS lists; accounts connected, of the draft's platform, in
    the company; no live post of it there already; no blocking issue (the
    facts now); owner mode = an approval of this version by an active owner
    (approved, or scheduled / published / failed sending to more accounts;
    one by someone made a member or removed since counts for nothing, and
    the draft's page offers Approve again: the approval becomes the new
    owner's and the status stays the queue's, db/content-draft-status.ts);
    auto_rule only when the owner ticked "without an approval" AND an
    enabled rule covers its platform and pillar (exact, the plan's names),
    its maker and switcher still active owners, and no claim needs an
    owner (reviewDraft's acknowledgmentNeeded: an unbacked claim or a hand
    edit). Then one job per account, the draft "scheduled", a "scheduled"
    row each. The browser sends a later time as ONE UTC instant it made in
    onSubmit (wallClockToUtc, lib/publishing/schedule-time.ts: the viewer's
    timezone; a skipped hour moves past the jump, a repeated one takes the
    first); the service refuses one over a minute ago or over a year ahead.
    publishing-changes: 120 per 10 minutes per person.
  - A change of the draft takes its waiting posts out, in its own
    transaction (db/publish-draft-sync.ts): an edit, the AI's new text or
    a change of its image or video (also from the media library) writes
    draft_changed_after_approval (when it had an approval or a waiting
    post) and cancels its QUEUED jobs (draft_changed); a rejection or an
    archive cancels them too. A job being sent ("publishing") or out is
    never touched: the check before sending catches the change. A
    scheduled draft can be edited, rejected or archived (each asks or
    warns first), a failed one too; a published one stays as it went out.
    The draft's status follows its jobs while it is scheduled / published
    / failed (lib/publishing/draft-status.ts: any queued or publishing =
    scheduled; else any failed or needs_attention = failed, "Publishing
    problem"; else all out = published; none left = approved while its
    approval holds, else a draft); a status a person set since stays. A
    failed job whose account has the draft on its way, out or waiting for a
    check again (scheduled or retried there since) doesn't count, and
    offers no Retry (the list says why: scheduledAgain, db/publish-jobs.ts).
    An approval leaves a draft the queue has in the queue's status (one a
    rule sent and that failed has no approval of its own), so marking its
    post later still moves it.
  - Running (services/publish-runs.ts, services/publish-attempt.ts,
    db/publish-runs.ts): a run CLAIMS a job in ONE UPDATE (queued and due ->
    publishing, claimed_at, a new claim_id, attempts + 1): by id for one
    company (right after an answer), or the next due one of any company
    ("id = (SELECT ... ORDER BY run_after LIMIT 1 FOR UPDATE SKIP
    LOCKED)": a scalar subquery on purpose, an IN subquery claimed
    several), the companies taking turns (each round one post per company
    with due posts, its longest waiting; a company whose post the daily
    limit held back gets no more turns in that run), so one company's long
    queue never takes a run from the others. Then ONE snapshot
    (db/publish-run-read.ts, repeatable read, read only) and
    lib/publishing/run-check.ts decide AGAIN, never trusting how it was
    scheduled: the draft not archived / rejected, still the approved
    version, scheduled or approved, a format ansa publishes; owner mode:
    the approval of that version, its approver still an active owner; rule
    mode: the rule still on and covering it, its maker and switcher still
    active owners; the account the company's, connected, of the platform;
    no blocking issue (the facts now) and, for a rule, no claim needing an
    owner. Any "no" = failed with its code, nothing sent. Then
    publish-attempts (30 tries a day per company, counted before the
    account is made ready, so a post held back costs no renewal or media
    read: past it, back in the queue an hour later, "daily_limit", the try
    given back), prepareConnectionForUse (renewed first; refused =
    needs_reauth and reauthorization_needed; no answer = tried again
    later), the media read (readPrivateFile, 30 s), the claim checked once
    more (still held, and younger than LATEST_SEND_START_MS: 10 minutes
    minus the platform's longest answer, so a post is never still going
    out when its claim counts as cut off;
    older = nothing sent, back in the queue, "run_too_slow", the try given
    back), publishPost. published -> the job published with the platform's
    id and address; not_created -> failed with the code (token_rejected
    also marks the account needs_reauth, guarded by the stored token), or
    rate_limited with attempts < 5 -> queued again after retry-after (30 s
    to a day) or 1, 2, 4, 8 minutes (lib/publishing/retry-timing.ts);
    unclear -> needs_attention. Each outcome is ONE transaction (the draft
    locked first, the job read and written only while "publishing" under
    this run's claim_id: a late writer never undoes another, also after a
    Retry, whose tries start again at 1), the draft's
    status and its activity row with it. A job "publishing" 10+ minutes
    after its claim was cut off while sending: needs_attention
    ("interrupted"), NEVER queued or sent again by itself (no platform
    offers a way to post only once, IMPLEMENTATION_PLAN decision 8). The
    pages list and count it so at once (db/publish-jobs.ts, nothing
    written by reading), and a person's Mark or Retry hands it over first,
    in its own transaction (handOverCutOffJobWithin, db/publish-runs.ts);
    otherwise the next runner does (on Hobby, a day away). A person checks
    the platform: "Mark as published" (the post's address
    kept only as https on the platform's own hosts, lib/publishing/
    post-urls.ts) or "Mark as not published" (failed), then maybe Retry.
  - Triggers: right after an answer that made posts due (scheduled for now
    or a moment ago, "Publish now", Retry: runPublishJobsNow through
    after()); GET /api/cron/publish (CRON_SECRET bearer, 404 without one,
    401 wrong, then publish-cron 300 an hour per IP: the secret first, as
    the webhooks' signatures, so calls without it, say from a pinger's
    other customers on its addresses, count for nothing; the daily job's
    "cron" limit the same; await connection(), maxDuration 300); the daily
    job FIRST, before its cleanup and stuck work (a run starts a job only
    in its first ~30 s). Every run starts a job only while its longest run
    fits in the 300 s counted from its start (LONGEST_PUBLISH_RUN_MS:
    renewal waits, the media read, YouTube's upload, the database), at most
    50; one stopping there with posts still due logs "Publish run stopped
    at its time limit / batch size: due posts are left for the next run".
    vercel.json keeps the daily job only (Hobby allows daily crons):
    minute-level needs Vercel Pro or an outside pinger (docs/going-live.md,
    section 8). Logs: "Publish job failed / needs attention / delayed:
    <platform> <code>", "Publish job held back: <platform> daily_limit",
    never the post or a token.
  - Owners on the queue or a draft's page: Cancel (queued only, asks
    first), Publish now (queued), Retry (failed, unless scheduledAgain, or
    needs_attention, asks first for the latter: it may post twice; checked
    like a new schedule, and then publishes the draft's current version),
    Mark as published / not published (needs_attention). Every post has the
    same buttons, so each names its post for screen readers after its own
    words ("Publish now: “Our lunch menu” on LinkedIn (Ana Baker)"). Retry
    and Publish now send right after the answer; the queue and the draft's
    page refresh themselves while a post goes out or just became due.
  - Auto-publish rules (services/autopublish-rules.ts, the queue page):
    made switched OFF (a pillar of the current plan, or any), switched on
    only by an owner after a confirm saying posts go out WITHOUT anyone
    approving each one; nothing in the code turns one on (a check reads
    every write). Switching off doesn't cancel: its posts fail when they
    run (rule_disabled).
  - Calendar (/cofounder/calendar): the next 28 days in the viewer's
    timezone (worked out in the browser), the company's posts (not
    canceled) and the drafts planned for a day that aren't on their way,
    coloured by status (the status always written too). "Plan the next 2
    weeks" (owners; services/calendar-planning.ts, askClaudeForCalendarPlan;
    calendar-plans: 10 an hour per company; maxDuration 300): needs a
    current marketing plan (else it says so, nobody is asked); the browser
    names its timezone in onSubmit; Claude gets the plan's pillars,
    campaigns and cadence (posts per platform for 14 days, at most 40 in
    all), the 14 dates from tomorrow and the topics planned then, each
    escaped (lib/calendar-plan/plan-prompt.ts; no fact, account or id);
    its answer (JSON schema + strict Zod; another field = unusable) is kept
    post by post (lib/calendar-plan/plan-answer.ts: a date of the 14, a
    platform with a target and never past it, a format the platform takes
    or its first, the plan's own pillar and campaign names or none, a topic
    of one plain line, no repeat); each becomes an idea (status idea, topic
    only) with planned_for at its local time, in ONE transaction, an
    idea_planned row each. Nothing is written, approved or scheduled.
- Co-Founder: analytics (step 42, /cofounder/analytics, after Queue in its
  row of links; everyone reads, owners ask for a review: canReviewPerformance,
  checked in the service AND in /db with the role read again FOR SHARE).
  post_metrics: one snapshot of one published post (publish_job_id,
  same-company foreign key), collected_at, views / reach / reactions /
  comments / shares / clicks / video_views, each an integer or NULL = the
  platform doesn't give it, never 0 for unknown (CHECKs: none negative, at
  least one number), source platform / dev_simulated ("Simulated
  (development)" wherever it shows), never changed; index (company, job,
  collected_at desc) for each post's newest. publish_jobs.metrics_attempted_at
  / metrics_error: the latest try (when claimed) and why it read nothing (a
  CODE, lib/metrics-errors.ts; CHECKs: only on a published job, with its
  try); a failure never makes a snapshot. performance_reviews: period_start /
  end, input_summary (exactly what was sent), review (what the code kept),
  creator (same-company foreign key); marketing_plans.performance_review_id
  (same-company foreign key): the review a plan read. Plain, like the plans.
  - Definitions (lib/metric-definitions.ts, pure; every field from
    docs/research/social-publishing-apis.md, section 5, checked 2026-10-28):
    per platform and column, collected from a field (X
    public_metrics.impression_count, like_count, reply_count, retweet_count +
    quote_count, non_public_metrics.url_link_clicks; Facebook reactions and
    comments summary.total_count, shares.count; YouTube statistics.viewCount,
    likeCount, commentCount), needs_permission (Facebook's insights,
    post_media_view and the rest: read_insights; YouTube's shares:
    yt-analytics.readonly; every LinkedIn member number: r_member_postAnalytics,
    a Community Management permission of an app of its own: none is asked
    for) or not_offered (X's reach, video views where ansa sends no videos),
    with one line the page shows.
  - Reading (fetchPostMetrics, one request a post: adapters/x-metrics.ts,
    facebook-metrics.ts, youtube-metrics.ts; LinkedIn asks nothing,
    needs_permission; the stand-in never makes numbers up, stand_in; not set
    up, not_set_up): answers through Zod (a count is a whole number from 0 to
    Postgres's integer, YouTube's strings of digits, else the answer is
    unreadable), a number left out = null, none at all = no_numbers (no
    snapshot); refusals as codes (401 token_rejected, 429 rate_limited, ...;
    X's 404, or a 200 holding only its .../2/problems/resource-not-found,
    = not_found). X's non_public_metrics only while the post is under 29
    days old.
  - Collection (services/post-metrics-collection.ts): the daily job, last
    (after posts, cleanup and stuck work, at most 100), and /api/cron/publish
    after its posts (at most 10 a call), each post started only while its
    longest read (LONGEST_METRICS_RUN_MS: the account made ready, one answer,
    the database) fits in the 300 s from the start. A post is due
    (db/post-metrics.ts) when published 1 hour to 30 days ago (X's 28:
    metricsReadDays, lib/metric-definitions.ts; X gives link clicks for 30
    days, asked for under 29, and a read without them would hide the ones
    read before, since the page and the review show each post's newest
    snapshot), with the platform's id (one marked published by hand has
    none), on Facebook, X or YouTube, not a stand-in's, and not tried in
    the last 20 hours; CLAIMED in
    ONE UPDATE (id = a scalar SKIP LOCKED subquery, metrics_attempted_at =
    now; updated_at untouched: the queue sorts by it), the longest waiting
    first. Then prepareConnectionForUse (needs_reauth = skipped with
    reauthorization_needed, nothing asked), the request, and ONE
    transaction: the snapshot and the error cleared, or the code
    (token_rejected also marks the account needs_reauth, guarded by the
    stored token, with its activity row). Logs: "Post metrics not collected
    / skipped: <platform> <code>", "Post metrics run stopped at its time
    limit / batch size: posts are left for the next run", "Post metrics run
    failed: <description>".
  - `pnpm simulate:post-metrics <publish job id> views=120 reactions=8 ...`
    (services/post-metrics-simulation.ts): a dev_simulated snapshot of a
    published post of a stand-in account only; refused for a real account's
    post, one not published, a number its platform doesn't have
    (not_offered), odd input, production and, by the script, outside a
    local database (the checks' guard). The page shows each stand-in post's
    command with its id.
  - The page (services/analytics-page.ts): ?period= 7 / 30 / 90 days (30 by
    default); the posts that went out then, newest first (200 listed, up to
    3,000 counted), each with its newest snapshot or why there is none (a
    stand-in's, no platform id, LinkedIn, past its platform's read days,
    the error, not read yet: lib/analytics/post-notes.ts, which never
    promises a read past those days, nor shows a failed last try then);
    totals per platform (lib/analytics/totals.ts: the sum of the numbers posts have,
    "Not available on <platform>" for not_offered, "Not read yet (needs a
    permission)", "No numbers yet"); the period's publishing problems (failed
    or needing attention, changed in it, newest 50, no buttons: act in the
    queue); when numbers were last read, tried and simulated; the newest
    review; what each number means.
  - "Review performance" (services/performance-review.ts, owners,
    performance-reviews: 10 an hour per company, counted only once a review
    can be made; maxDuration 300): Claude is never asked below 5 posts with
    numbers in the period (the page and the refusal say how many more). The
    request (lib/performance-review/review-input.ts, review-prompt.ts) holds
    aggregates only: the newest 100 posts with numbers, labeled P1... in the
    order they went out (platform, format, pillar, the topic escaped with
    card numbers hidden, weekday and HH:00 in the owner's timezone, which the
    browser sends in onSubmit, and only the numbers it has), and groups G1...
    per platform and per pillar (posts, <metric>_total, _posts and _per_post
    to one decimal); no account, person, id or post text. Answer (JSON schema
    + strict Zod): findings [{ text, evidence [{ post_label | group, metric,
    value }] }], recommendations [{ text, based_on_findings }],
    limits_of_this_data. THIS CODE (review-answer.ts, text-numbers.ts) keeps
    a finding only when every value it cites equals the request's under that
    label and name and its text writes no other number (a time HH:MM, or
    digits of a cited topic or name, aside; any script's digits count, read
    after NFKC, and a cited value only in 0-9, which the prompt asks for);
    a recommendation only with a kept finding (renumbered), writing only
    their numbers; a limit only the request's numbers. No finding left =
    nothing saved ("The review failed:
    ..."). The newest review shows on the page, each number in words, and
    goes to the next marketing plan as <past_performance>
    (lib/performance-review/past-performance.ts: its kept findings with
    their numbers, escaped, card numbers hidden, each post's topic and
    pillar as the review's own request sent them, never the whole stored
    text the page shows), recorded on the plan and named under "What this
    plan was made from".
- One product (step 43; one sidebar and Home since step 44): both modules
  in one app.
  - Home (/dashboard, h1 "Home"; simplified in the "easy to use" pass of
    2026-11-01, app/dashboard/page.tsx), top to bottom: the green status
    card (status-card.tsx, step 44's signature: what ansa does right now,
    from Presence in services/away.ts, the briefing's sentence of
    lib/home-briefing.ts, and the ONE button that changes it for owners:
    Turn ansa on / Pause ansa / I'm away / I'm back; members read);
    "Getting started" (getting-started.tsx, services/home.ts, owners only,
    gone once all are done: Telegram connected and allowed to reply, an AI
    engine ready, and a business's menu or a person's instructions); "While
    you were away" (only in "Only when I'm away": answering always, "What
    ansa did" says it); "Needs you" (needs-you.tsx): new orders to accept
    (step 52), the newest 5 conversations
    that need a person, by name with the request's subject or the waiting
    reply (the Inbox's own needs-you view), "See all N", then each other
    thing that waits only above 0: requests nobody has (a business where
    more than one person takes requests: otherwise they are the
    conversations listed),
    stuck emails, posts needing attention (one cut off while sending too)
    and failed in the last 7 days (by their last change), social media
    accounts needing a reconnect as of now (connectionStatusAsOfNow,
    services/social-accounts.ts); with none, "Nothing needs you right
    now."; "What ansa did"; and, for businesses only, "Your business in
    numbers" (business-overview.tsx): open requests, calls of the last 7
    days and those ansa solved, emails being read, and once the company
    started the marketing helper (a fact, an interview message or a
    draft: db/cofounder-progress.ts, one EXISTS each) key facts confirmed
    (x of 16), posts waiting for approval (status draft) and posts
    scheduled within the next 7 days (queued, due ones too: it links to
    the queue's Scheduled list). Every number is a NumberLink to the list
    it counts, read with that list's own condition (db/business-overview.ts:
    the ticket views, the call filters, isStuckInboundEmail, the queue's
    needs-attention). Every count is a scalar subquery of the company's own
    row that reads at most OVERVIEW_COUNT_LIMIT + 1 rows
    (lib/business-overview.ts): past 10,000 the page says "10,000+", so it
    never reads a company's whole history. Members see the same numbers
    (every page they link to is readable by members).
  - The Co-Founder Overview's "Getting started" checklist
    (lib/cofounder/getting-started.ts, pure; services/cofounder-overview.ts
    reads the state): answer the interview (finished as the Overview says
    it), confirm the key facts (all 16), make a plan, write a first draft
    (one holding anything: the opposite of the idea CHECK), connect an
    account (connected as of now; a stand-in counts and says so), schedule
    a first post (any job not canceled), see how posts did (any snapshot,
    a simulated one too). Each says what it found and links its page;
    everyone reads it.
  - What holds it together, as checks: every tenant table has a NOT NULL
    company_id, and every foreign key between tenant tables and every
    *_user_id column is a same-company key (schema-checks.ts, read from
    Postgres's catalog); cleanup.ts empties every tenant table; every
    Co-Founder page reads the session inside <Suspense> with its loading
    line, names its own address for the login, has a not-found page where
    its address holds an id, and sets maxDuration 300 exactly where its
    actions ask Claude or send posts (cofounder-consistency-checks.ts);
    .env.example and docs/going-live.md name every setting lib/env.ts
    reads, the README every package script, and every file the docs name
    exists (docs-checks.ts); one company walks from signup to a checked
    performance review through the services, and another company's member
    finds none of it (journey-checks.ts).
  - Retention and deletion: owners delete knowledge articles, start the
    interview over (the facts stay), and disconnect accounts (the tokens are
    deleted at once); anyone archives drafts and deletes media. A post that
    went out stays on its platform: nothing in ansa deletes a published post
    (a published draft can't be archived, and disconnecting or deleting
    leaves what went out). The daily job deletes only old rate limit
    counters and expired sessions, reset links and social connection
    attempts, and (step 48) Telegram link codes past their hour and
    Telegram connections no code named (services/maintenance.ts).
- Times: stored in UTC, shown with components/local-date-time.tsx (the viewer's own
  timezone). Lists page with ?page= (lib/pagination.ts, 50 per page, at most
  10,000 pages: links never point past that). The ticket list also reads ?view=
  (open, mine, unassigned, solved, all; members land on mine, owners on open) and
  ?q=, the call list ?outcome= (solved, needs_human, stuck) and ?q=, the
  knowledge list ?status= (all, draft, approved, archived) and ?q= (titles),
  the content studio ?status= (current, idea, draft, approved, rejected,
  scheduled, published, failed, archived) and ?platform= (all or one), the
  Analytics page ?period= (7, 30 or 90 days, step 42), all parsed in
  lib/validation/list-queries.ts (odd values fall back to the default). "mine"
  is always session.userId, never a URL value. Every list link and Previous/Next
  keep the filters (buildListUrl). Search is ILIKE with %, _ and \ escaped
  (lib/search-patterns.ts), values as parameters; db/ticket-filters.ts and
  db/call-filters.ts hold the conditions, and db/tickets.ts / db/calls.ts put the
  company first in one WHERE builder used by the list and the per-view counts.
- Next.js 16 has Cache Components on: any component that reads the session must
  sit inside <Suspense>. See app/dashboard/page.tsx. Read @AGENTS.md before
  writing Next.js code; this version differs from older docs.
- The app's navigation (step 44) lives in each signed-in section's layout.tsx
  (app/dashboard, inbox, tickets, calls, emails, knowledge, cofounder, team,
  setup, billing, account, settings), through AppFrame
  (components/app-frame.tsx): from 768 px wide a forest-green frame
  holding the sidebar (components/app-navigation.tsx, ansa's bell mark,
  components/brand-mark.tsx) and the page on a white sheet, and below that
  a frosted-glass bar floating at the bottom of the screen with the same
  links (solid where the browser can't blur; the page is padded so it never
  covers the page's end). The sections, in this order (components/section-links.tsx,
  navigation-checks.ts): Home (/dashboard), Inbox (/inbox), Settings
  (/settings) since the "easy to use" pass of 2026-11-01 (the marketing
  studio, Content until then, is a Settings link for businesses: "Social
  media posts"); Orders after the Inbox for a business that takes orders
  (step 52, below). The links are static: each
  layout names its section (marked with aria-current), app/cofounder
  included (Settings). Inbox: conversations, All requests
  (/inbox/requests), tickets, calls, emails; Settings: knowledge, team,
  setup, billing, account, cofounder. Settings (app/settings/page.tsx)
  lists by kind: a business's "Your assistant" (Assistant, Channels, What
  it knows, Menu and prices), "More tools" (Social media posts and
  accounts, Saved answers = Knowledge, Phone, email and documents), "Team
  and account", Log out, and the older marketing pages folded in a
  <details>; a person's "Your assistant" (Assistant, Channels, About you,
  Saved answers, Email forwarding) and "Account" only. Only the sidebar's foot
  ("who you are": company, address, Account, Log out) reads the session,
  inside <Suspense>, at one fixed height (names cut short with "..."), the
  same as its placeholder, so nothing moves when the session arrives. A
  phone has no sidebar: Settings lists Account and Log out, Billing
  (owners), and every page the sidebar doesn't link (the Co-Founder's other
  pages under "Older pages" until step 58; a person's account doesn't list
  the marketing pages); the Inbox links Calls and Emails. An error boundary sits beside the sidebar
  (components/page-error-boundary.tsx, Next's catchError), so it stays
  when a page or a server action fails. Pages never render the navigation,
  and each has its own h1 (the sidebar has none; a check reads every
  signed-in page for one, scripts/tenant-isolation/page-heading-checks.ts).
  getSessionContext is cached per request (React cache): sidebar and page
  read the session once. A ticket, call, knowledge article, plan version or
  content draft that can't be shown has its own not-found.tsx inside the
  frame; app/not-found.tsx, app/error.tsx and
  app/global-error.tsx catch everything else. Error screens never show an
  error's message, only Next's digest as a reference
  (components/something-went-wrong.tsx). Ticket, call, article and draft tabs are
  titled per ticket, call, article or draft (generateMetadata, read once with React cache).
- Restaurant setup (step 45, /welcome; Settings → Assistant at
  /settings/assistant and What it knows at /settings/business). companies
  gains kind (business; personal later), business_type (the list in
  lib/restaurant-setup.ts, CHECKs equal to it), setup_progress (0-6: how
  many steps were saved, only ever raised) and setup_finished_at.
  assistant_settings: one row per company (company_id the primary key),
  status on / paused, reply_mode automatic (the default) / ask_first, the
  holding reply (DEFAULT_HOLDING_REPLY until an owner edits it, 1-500),
  instructions (0-2,000), takes_orders, time_zone + opening_hours (both or
  neither; lib/opening-hours.ts: at most two times a day, never
  overlapping, within 00:00 to 24:00, a closing 00:00 = midnight), delivery
  with its note, pickup, payment note, currency (ISO 4217), public_phone,
  alert_by_email, updated_by_user_id (same-company foreign key). Plain text
  on purpose: the restaurant's own information for its customers. The
  business's name, what it serves and its address are business facts
  (company_name, description, location), written as the owner's confirmed
  values (db/setup-facts.ts, inside the setup's transaction, without the
  Profile page's "what the page showed" check), so posts can use them.
  - Steps (SETUP_STEPS): business (name, kind, what it serves), contact
    (address, phone), hours (time zone, picked from the device in the
    browser until one is saved), orders (orders, delivery, pickup,
    payment, currency), assistant (instructions, holding reply; the mode
    stays Automatic), channels (the forwarding address and phone lines;
    Telegram and Messenger "coming next"), ready (a read-back, then
    "Open ansa" sets setup_finished_at, refused before all six were
    saved). ?step= names a step; one further than the progress shows the
    first one left, so setup resumes where it stopped. /welcome has no
    sidebar (a frameless signed-in folder, navigation-checks.ts).
  - Owners change it, members read it (canManageRestaurant,
    lib/restaurant-permissions.ts), checked in the services AND in /db:
    every write takes the company row lock first, then reads the person's
    role again FOR SHARE (asRestaurantOwner, db/restaurant-owner.ts).
    settings-changes limit; Zod (lib/validation/restaurant-setup.ts); /db
    names every column. A form's hidden "from" field only picks where the
    browser goes next (the next step, or "Saved.").
  - Home sends an owner whose setup isn't finished to /welcome (a new owner
    lands there after confirming their email); members see a line that an
    owner is still setting up. The sidebar's foot shows the reply mode and
    today's hours in the restaurant's own time zone ("Open until 23:00",
    describeHoursNow). Nothing here reaches a customer or the AI before
    steps 46 to 49.
- Menu (step 46, Settings → What it knows → Menu at /settings/menu, "Read
  my menu" at /settings/menu/read). catalog_items: one row per dish or
  drink (named for a shop's products later): category ("" = "Other
  dishes", 0-60), name (1-120), description (0-500), price_cents (whole
  smallest units of the currency setup chose: cents for EUR, yen for JPY,
  lib/menu.ts minorUnitDigits; 0 to 100,000,000), unavailable_until (null
  = available), position, creator and last changer (same-company foreign
  keys). At most MENU_ITEMS_MAX (500) per company, counted under the
  company row lock. Plain text on purpose: the restaurant's own menu.
  - Owners add, change, move (within its category) and delete dishes
    (canEditMenu); anyone in the company marks one "Not available today"
    (canMarkMenuAvailability: whoever is working knows first), which
    lasts until the restaurant's next midnight in its own time zone
    (endOfLocalDay, lib/opening-hours.ts; UTC before setup chose one) and
    then ends by itself (read with the database's clock). Checked in the
    services AND in /db (role read again FOR SHARE); menu-changes limit.
    No menu before a currency: every price is typed as text and read by
    parsePrice in it (one "." or "," before at most the currency's
    digits; a minus is no price).
  - "Read my menu" (owners, services/menu-reading.ts, menu-readings: 20 an
    hour per company): a photo (JPEG, PNG, WebP or GIF, its type read from
    its own first bytes, never the name), a PDF or .docx (its text, as for
    knowledge imports) or pasted text (at most 20,000 characters), up to
    4 MB. Claude (askClaudeForMenuReading, lib/menu-reading/prompt.ts:
    the text escaped inside <menu>, data never instructions) returns
    { items: [{ category, name, description, price }] }; this code keeps
    each row on its own (lib/menu-reading/answer.ts: a name, a price it
    can read, one plain line each, at most 150) and says how many were
    left out. NOTHING is saved by reading: the list comes back to the page
    to check and edit, and only "Looks right" adds it (every row checked
    again, all or none, a bad price naming its dish). Without an API key
    the development stand-in (adapters/dev-menu-reader.ts) answers a
    labelled sample menu; production says reading isn't available
    (menuStandInAllowed).
- Inbox (step 47, /inbox, one conversation at /inbox/<id>, the ticket list
  at /inbox/requests "All requests"). contacts: one customer on one
  channel (telegram, messenger, phone, email, stand_in; unique per company,
  channel and external id: the phone's digits, customerPhoneDigits; a
  lowercased email address, "unverified:" first when the sender wasn't
  verified (step 25), so a forged From never joins a real customer's
  conversation; a chat id). conversations: one per contact, handled_by
  assistant / person (who took it over and when, a CHECK keeps them
  together), last_activity_at (the Inbox's order),
  last_customer_message_at. messages: a chat message (body encrypted,
  conversationMessageContext) or a link to a call or a received email of
  the same company (never a copy), exactly one of the three (a CHECK); in
  = customer, out = assistant / person with a send status; one per channel
  message id per conversation (a message arriving twice is saved once);
  clock_timestamp() keeps their order. assistant_activity: what ansa did
  (actor empty) and a person's take over / hand back, never a message's
  text. calls, inbound_emails and tickets carry conversation_id (all
  same-company foreign keys).
  - A call joins its caller's conversation when it is saved (insertCallIfNew,
    in its transaction; a hidden caller: none), its ticket the call's
    (insertTicketWithNextNumber reads it from the call), and the decision
    writes ansa's line (call_solved / call_needs_person). A received email
    joins its sender's conversation when it becomes a ticket
    (saveInboundEmailTicket, in its transaction), with the ticket and
    ansa's line (email_made_request). Calls and emails from before step 47
    are not linked (no backfill); filtered mail never is.
  - "Needs you" = a conversation with an open ticket, or (step 49) a reply
    of the assistant waiting for a person (needsYouCondition,
    db/conversations.ts); Home's "N conversations need you" counts with the
    same condition. A conversation's page shows its entries (each voice its
    own: the customer, ansa with its bell, a person by name), Take over /
    Hand back, a reply box on chat channels only (replying takes it over),
    and its newest open request with that ticket's own actions
    (TicketActions, NoteForm) and a link to the whole request. Everyone in
    the company works conversations, as they work tickets; the person is
    read again in /db; inbox-changes limit.
  - Replies go out through lib/chat-delivery.ts, the ONLY door: saved
    "sending" first (encrypted), then sent, then "sent" / "failed" /
    "unclear" recorded with the channel's id or a reason code
    (messages.send_error, SEND_ERRORS in lib/conversations.ts; only over
    "sending"). The development stand-in channel, and a stand-in Telegram
    account (step 48), write them to .dev-messages/
    (adapters/dev-chat-outbox.ts, git-ignored); production never uses
    them ("not_connected"). `pnpm simulate:message` brings a stand-in
    customer's message in (local database only).
- Telegram (step 48, Settings → Connections at /settings/channels, POST
  /api/webhooks/telegram). A restaurant adds ansa's ONE bot to its own
  Telegram account as a Telegram Business chatbot; customers write to the
  restaurant's account as always. channel_connections: one Telegram
  account of one company (Telegram's business connection id, the
  account's user id and the bot's chat with it, its name, status
  connected / cannot_reply (the owner didn't allow replies) /
  removed_in_telegram / disconnected (an owner, in ansa), is_stand_in,
  connected_by with a same-company foreign key). Partial unique indexes:
  while not disconnected, a Telegram account is tied to one company and a
  company has one Telegram account.
  - Connecting (owners: canManageRestaurant, in the service and in /db
    under the company row lock): "Connect Telegram" makes a one-time code
    (32 random bytes, only its SHA-256 stored in telegram_link_codes, 10
    minutes, settings-changes limit) and opens t.me/<bot>?start=<code>.
    The owner's Start CLAIMS it in one UPDATE with their Telegram user id;
    the chatbot added in Telegram (a business_connection update from that
    same user within the hour) is then tied to the code's company, in ONE
    transaction (company row lock, the code's maker read again as an
    active owner, the code locked and unused). Added before the Start, it
    waits in telegram_pending_connections and the Start ties it. The
    company comes ONLY from a code; nothing Telegram sends names one. An
    account tied to another company is refused ("disconnect it there
    first"); a company's account removed in Telegram is replaced. The bot
    tells the owner what happened in its own chat (BOT_NOTES, fixed
    texts, after the webhook's answer). Telegram's later updates of a tied
    account set its status (removed, added back, reply permission, name);
    an owner's Disconnect is final until a new code.
  - Messages (services/telegram-updates.ts): a business_message of a
    connected account (connected or cannot_reply) joins the customer's
    conversation (contact = Telegram's chat id, telegramContact), saved
    once per Telegram message id; text and caption only, other contents
    named ("[A photo: open Telegram to see it]", lib/telegram.ts), never
    downloaded. One written by the account itself (from = the account's
    user) is saved as author "business_account" ("Written in Telegram");
    one sent by the bot (sender_business_bot: ansa's own reply coming back)
    is not saved again. deleted_business_messages delete ansa's copies.
    Edits are ignored (Known gaps). Encrypted with
    conversationMessageContext; never logged.
  - Replies (lib/chat-delivery.ts -> adapters/telegram.ts, the ONLY file
    that talks to Telegram; the token is in every address, so no address,
    error or answer is logged, and only ok, message_id and the HTTP status
    are read): refused BEFORE anything is saved when the company has no
    connected account, ansa may not reply, or the customer's last message
    is over 24 hours old (Telegram's rule for chatbots; the conversation
    page says so instead of offering the box). Telegram's message id is
    kept; 429 rate_limited, 401/404 bot_rejected, other refusals refused;
    no answer or a 5xx is "unclear" (no_answer) and is never sent again
    by itself.
  - Modes (lib/telegram-mode.ts, like social accounts): "real" with all
    three of TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and
    TELEGRAM_WEBHOOK_SECRET (lib/telegram-settings.ts, set together),
    "stand-in" in development without them (a stand-in account, `pnpm
    simulate:telegram`, replies to .dev-messages/), "not-set-up" in
    production. `pnpm telegram:poll` (development, local database) reads a
    real bot with getUpdates and hands each update to the same code;
    `pnpm telegram:webhook set | remove` is the operator's. The checks
    refuse to run while TELEGRAM_BOT_TOKEN is set. Limits:
    telegram-webhook (per IP, a ceiling), telegram-bot-chat (messages to
    the bot's own chat, per Telegram user).
- Messenger (step 53, Settings → Connections, POST and GET
  /api/webhooks/messenger). A business connects its Facebook Page with the
  SAME login as posts (step 40's facebook connection): ansa's Meta app now
  also asks for pages_messaging and pages_manage_metadata (lib/messenger.ts
  MESSAGING_SCOPES; posting needs only its three, so a person may untick
  messages), and right after the callback each Page with both granted has
  its messages switched on for ansa's app (services/messenger-pages.ts,
  subscribed_apps: messages and message_echoes; best effort, one fixed log
  line when Meta refuses). Channels lists each Page with "Messages come to
  ansa" or "Connect it again and allow messages"; a person's account is
  told a personal profile can't be connected.
  - The webhook (services/messenger-webhook.ts): size cap 512 KB, raw
    bytes, X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body,
    FACEBOOK_APP_SECRET), compared in constant time (no Meta app = 401),
    per-IP limit (messenger-webhook, a ceiling), JSON, Zod
    (lib/validation/messenger.ts: only ids, mid, text, the first
    attachment's kind, is_echo and app_id), 200 even for an event ansa
    can't read. GET answers Meta's setup check with hub.challenge only for
    MESSENGER_VERIFY_TOKEN (constant time), else 403.
  - A customer is a Page-scoped id: contacts.external_id
    "<page id>:<psid>" (lib/messenger.ts, split at the last ":"), so a
    reply goes back through that Page. A customer's message joins their
    conversation once per Meta mid; text, or the attachment named ("[A
    photo: open Messenger to see it]"), never downloaded; their name is
    read from Meta once, after the answer, when the contact has none
    (best effort). An echo sent by ansa's own app (app_id) isn't saved
    again; any other echo is the Page's own message (author
    "business_account", clears the catch-up's wait). Then the assistant
    answers it as it does Telegram's (step 49 onwards, orders included).
  - Sending: every message to a customer goes through
    services/chat-send.ts (sendToCustomer), which reads a Messenger Page's
    token first (prepareConnectionForUse: only services decrypt tokens),
    then lib/chat-delivery.ts → adapters/messenger.ts (the ONLY file that
    talks to Messenger: Send API, messaging_type RESPONSE, appsecret_proof;
    a text over 2,000 characters goes as parts cut at a line break or a
    space; Meta's 10/2018278 = reply_window_closed, throttling =
    rate_limited, 190 = not_connected, a 5xx or no answer = unclear,
    never sent again by itself). The route (db/messenger-routes.ts, read
    in the saving transaction like Telegram's): the Page connected in this
    company, pages_messaging granted (or a development stand-in), and the
    customer's last message under 24 hours; otherwise refused before
    anything is saved, and the conversation page says why.
  - Modes: Facebook's (lib/social-mode.ts): "real" with FACEBOOK_APP_ID and
    _SECRET; "stand-in" in development (the stand-in Page of step 40, `pnpm
    simulate:messenger`, replies to .dev-messages/); production without
    the app has no Messenger.
- WhatsApp Business (step 56, core/internal/whatsapp, docs/backend/modules/
  whatsapp.md; Settings → Connections, POST and GET /webhooks/whatsapp). A
  business, or one person who uses the WhatsApp Business app, connects its
  number through Meta's Cloud API; a personal WhatsApp number can never be
  connected (no allowed API). The owner may keep using the WhatsApp
  Business app on the same number (Meta's "coexistence").
  - Connecting (owners; settings-changes limit): Meta's own sign-up window
    (Embedded Signup, coexistence allowed: featureType
    whatsapp_business_app_onboarding) reports a one-time code (30 s) and
    the business account and number; the page hands them to core at once,
    and they are claims until Meta confirms them server to server
    (whatsapp.Confirm): the code exchanged for the business's token; the
    token ansa's app's, valid and granted whatsapp_business_messaging for
    that account (debug_token); the number among the account's, Meta's own
    is_on_biz_app saying whether the app shares it (never the browser);
    ansa's app subscribed to the account's webhooks; a number not shared
    with the app registered with a random six-digit PIN ansa never keeps.
    The owner and "no number yet" are checked before Meta is asked and
    again when saving (settings.AsOwner: the company row lock, the role
    read again), the token encrypted (social.WhatsAppTokenContext). One
    number per company and per number (partial unique indexes: a number
    connected in another company is refused). Disconnect deletes the
    token (the row stays); the business removes ansa on Meta's side itself.
    No past chats or contact book are imported (no history sync).
  - Messages: the webhook runs the webhook order (512 KB, Meta's
    X-Hub-Signature-256 with FACEBOOK_APP_SECRET, the whatsapp-webhook
    per-IP ceiling, strict reading, 200 for what ansa can't read). The
    company comes ONLY from the phone number id Meta signed, connected in
    exactly one company. A customer is "<phone number id>:<customer id>",
    the customer id their business-scoped user id ("US.1349...", in every
    message since April 2026; a WhatsApp username may hide the number), else
    their number's digits. Text, a button's or list's choice and captions
    are kept; media named ("[A voice message: open WhatsApp to see it]"),
    never downloaded; reactions and WhatsApp's notices left out. Saved once
    per WhatsApp message id, encrypted, the assistant's answer queued. An
    smb_message_echoes message is the business's own (author
    business_account, "Written in the WhatsApp Business app"; the catch-up
    stops waiting). account_update PARTNER_REMOVED / ACCOUNT_OFFBOARDED =
    removed_in_whatsapp (nothing arrives or goes, the token kept),
    ACCOUNT_RECONNECTED = connected again; an owner's disconnect is final.
  - Replies (chat.RouteWithin → whatsapp.Send; the token read right before
    by social.WhatsAppToken): the number connected in this company and the
    customer's last message under 24 hours (Meta's rule), else refused
    before anything is saved; the token in the Authorization header, never
    an address, with appsecret_proof; a business-scoped id as "recipient",
    a number as "to"; 131047 = reply_window_closed, throttling =
    rate_limited, 190 / 133010 = not_connected, a 5xx or no answer =
    unclear (never sent again by itself). The conversation page words
    each channel (lib/conversations.ts sendErrorText, WRITTEN_IN).
  - Modes (whatsapp.Connector.Mode): "real" with FACEBOOK_APP_ID, _SECRET
    and WHATSAPP_SIGNUP_CONFIG_ID; "stand-in" in development (a stand-in
    number, `make simulate-whatsapp`, replies to .dev-messages/);
    "not-set-up" in production without them. WHATSAPP_VERIFY_TOKEN answers
    Meta's setup check.
- "Post for me" (step 54, Settings → Posts for me at /settings/posts,
  businesses). ansa plans, writes and posts on the business's Facebook
  Page by itself; the owner never gives it a topic.
  - The switch (assistant_settings.autopost_*: on, frequency daily /
    three_a_week (Mon, Wed, Fri) / weekly (Fri), a local time in
    time_zone, mode automatic / ask_first; who switched it on and when, a
    CHECK: on = an owner named and a time zone). Owners only
    (asRestaurantOwner, settings-changes limit); Automatic needs the
    owner's tick ("ansa may post without asking me each time"), and then
    switches on the company's Facebook "any pillar" auto-publish rule in
    the owner's name through step 41's own owner switch
    (setAutopublishRuleEnabled); Ask me first or off switches it off. Off
    also takes back the posts still on their way (archived: out of the
    queue; one already out stays).
  - The brain (lib/autopost/brain.ts, pure): a mix of kinds per business
    type (food or other: spotlight, behind the scenes, a question, come
    and see us, a tip), a special day on its date (a short fixed list),
    "come and see us" weighed up on Thursday and Friday, the dish or
    product spotlighted least recently next, a kind used in the last three
    posts weighed down, and each kind's weight times how its posts did
    (reactions + comments + shares of each post's newest numbers, step 42,
    against the average, 0.5 to 2).
  - Writing (services/autopost-writer.ts): the posting time is CLAIMED
    first (autopost_slots, unique company + post_at: two runs write it
    once). The company's assistant engine writes it (assistantAskerFor
    "post": the owner's key, ansa's, or Claude Code in development) from
    the business's own details only (lib/autopost/prompt.ts: name, kind,
    about, address, hours, up to 40 offers with their prices, the owner's
    instructions and words to avoid, the newest 5 posts' first lines, the
    brain's choice; every value escaped, card-like numbers hidden). The
    answer (lib/autopost/answer.ts, strict), then ansa's checks
    (lib/autopost/checks.ts: step 49's price, refund and link checks on
    the published text, any percentage and any discount / promo / coupon
    word only when the owner's own texts hold it, Facebook's rules and
    words to avoid); a second try on another kind; still stopped = skipped
    with a code (lib/autopost/slots.ts). A kept post becomes a content
    draft in the owner's name (no claims: ansa's checks replace them) and
    is scheduled through scheduleDraftPosts without an approval
    (auto_rule, re-checked when it runs, step 41), or waits for an owner
    (Ask me first, or when the queue refuses it).
  - Runs: /api/cron/publish and the daily job
    (services/assistant-scheduled.ts, after the assistant's catch-up), and
    `pnpm assistant:catch-up` in development, write each posting time's
    post within a day of it, at most 10 a run, each only while two AI
    tries still fit its 300 s. "Post one now" (owners, autopost-now: 5 an
    hour per company) writes one for this moment and sends it after the
    answer (maxDuration 300).
  - The page: what ansa is doing and the next three times, the form, and
    ansa's newest 20 posts with where each is (being written, scheduled,
    posted, waiting for approval, couldn't be posted, taken back, skipped
    and why) and its reactions, comments and shares.
  - Setup's business types (widened in step 54, a CHECK): food
    (restaurant, café, bakery, takeaway, food truck, bar, catering) and
    shop, salon or beauty, clinic, gym, services / freelance / agency,
    estate agent, something else.
- The restaurant assistant (step 49; rule changes 1 and 2 of 2026-10-31:
  it reads the restaurant's own details and the ONE conversation it
  answers, and the AI's replies go to customers after ansa's checks).
  services/assistant-reply.ts runs once per customer chat message (Telegram
  after the webhook's 200, pnpm telegram:poll, pnpm simulate:telegram and
  simulate:message), after a 1.5 s wait so a burst gets one answer.
  - Quiet (nothing sent, holding reply included) while: paused, the
    conversation taken over, a request open in it (one holding reply until
    a person answers), a newer customer message (its own run answers), or
    the message handled already (conversations.assistant_handled_message_id).
    Checked before Claude is asked and AGAIN inside the transaction that
    saves (db/assistant-runs.ts, the conversation row locked; the handover
    takes the company row lock first, as routing must).
  - What Claude reads (lib/assistant/prompt.ts, services/assistant-inputs.ts):
    the restaurant's name, what it serves, address and public phone, its
    hours with "now" in its time zone, delivery / pickup / payment notes,
    the AVAILABLE dishes with labels M1... and prices as the menu shows
    them, the owner's instructions, up to 3 approved support articles
    matching the customer's last message (3,000 characters), the active
    category names, and the newest 20 messages of this conversation (cut
    to 1,000 characters each, never splitting an emoji). Every value
    escaped in its tag; customers' text with card-like and SSN-like numbers
    and email addresses hidden, the owner's with card-like numbers hidden.
    No id, account, other customer or other conversation. The system
    prompt says all of it is data, not instructions.
  - Its answer (lib/assistant/answer.ts, JSON schema + strict Zod): action
    reply / needs_person / no_reply, the reply (at most 1,500 characters,
    else unusable), a handover reason (unsure, complaint, refund,
    asked_for_person, order: a business that takes no orders here;
    needs_decision, step 50; order_change, step 52), a subject and
    summary for the request, a category name, and (step 52) an order by
    menu label with the actions order_summary / order_confirmed /
    order_withdrawn (see Orders below).
  - ansa's checks before a reply may go (lib/assistant/reply-checks.ts):
    every amount written with a currency mark is a menu price or an amount
    in the owner's own texts (notes, instructions, articles); no refund,
    compensation or voucher words (several languages); every link appears
    in the owner's texts. The first automated message of a conversation
    starts with ansa's own line "I'm the AI assistant for <restaurant>."
    (lib/assistant/ai-label.ts), never the AI's.
  - Anything else hands over (services/assistant-handover.ts,
    db/assistant-handover.ts, ONE transaction): the restaurant's holding
    reply (with the AI label when first; never the AI's text), a request
    (tickets.channel "chat", the AI's subject and summary or fixed words,
    always the reason, HANDOVER_REASONS in lib/assistant/reasons.ts; the
    category by id; routed, its assignee emailed after commit) in the
    conversation, an assistant_activity "handed_over" row with the reason.
    Then the owners are alerted (services/owner-alerts.ts: an email to each
    confirmed, active owner while alert_by_email is on, and a note from
    ansa's bot in the restaurant's own Telegram; who, where and why with a
    link, never the messages; owner-alerts limit). Reasons: the AI's own,
    price_not_on_menu, refund_promise, unknown_link, unusable_answer,
    model_failed, model_unavailable (no engine), reply_limit, send_failed
    (the reply itself failed: a request and an alert, no holding reply).
  - Automatic (the default) sends at once; "Ask me first" saves the reply
    as a "draft" (one at a time: a newer one discards it) that shows under
    Needs you with Send (as written), Edit (?edit=<id>: the reply box, a
    person's reply that replaces it in its transaction) and Discard
    (ConfirmButton), anyone in the company (db/assistant-drafts.ts, the
    person read again, the reply route checked as for a person's reply,
    db/reply-routes.ts). Holding replies never wait.
  - The AI engine (Settings → Assistant, owners; lib/assistant/engine.ts):
    "Claude API key" uses the restaurant's own key (assistant_settings.
    anthropic_key_encrypted, anthropicKeyContext, shown only as its last
    four; an unreadable one is never replaced by ansa's) or else ansa's
    ANTHROPIC_API_KEY; "Claude Code on this computer" runs `claude -p`
    (adapters/claude-code.ts) on the developer's own login, DEVELOPMENT
    ONLY: Anthropic doesn't allow a product to run on a claude.ai login
    (Agent SDK docs), so production refuses to save it and never runs it
    (model_unavailable). It runs locked down: no tools, no MCP, no setting
    sources, no CLAUDE.md or memory, no saved session, an empty temporary
    folder, only PATH, HOME, USER, LOGNAME, LANG and TMPDIR passed on (never
    ansa's secrets), the conversation on stdin, the answer its
    structured_output, 90 s; CLAUDE_CODE_PATH names the program. No engine =
    every message gets the holding reply and a request.
  - "Test your assistant" (owners, assistant-tests limit) runs the same
    inputs, engine and checks on one typed message and shows the reply or
    the handover and why: nothing saved, sent or alerted.
  - Limits: assistant-replies per restaurant per hour (past it: handover,
    reply_limit) and per customer conversation per hour (past it: quiet).
    LOGGING RULE: never a message, the prompt or the AI's answer; "Assistant
    reply failed: <class>", "Claude call failed: <name>".
- ansa for one person (step 50). companies.kind "business" or "personal",
  picked at setup's first step ("Who is ansa for?": My business / Just
  me; lib/restaurant-setup.ts COMPANY_KINDS). A person's setup has its own
  steps (PERSONAL_SETUP_STEPS: who, away, assistant, connect, ready;
  setupStepsFor, savedSetupSteps); changing the kind starts the later steps
  again (setup_progress = 1), switches answer_when (a person's:
  "when_away") and the holding reply while it is still one of ansa's own
  (personalHoldingReply: their NAME, never a pronoun). A person has no
  business type, menu, address, opening hours or orders; the first step
  shows their name ("as ansa should say it") and what they do, by CSS
  alone (group-has on the kind radio). The assistant reads a person's
  <person> and <availability> instead of a restaurant's tags, with its own
  system prompt (PERSONAL_SYSTEM_PROMPT: never pretend to be them, never
  commit them to a meeting, time, money or decision, never share what's
  private unless their instructions say so; hand over with needs_decision,
  asked_for_person, unsure...), and says "I'm <name>'s AI assistant."
  (aiLabel with the kind). Handover texts are neutral ("They complained.").
- Only when I'm away (step 51, lib/assistant/availability.ts):
  assistant_settings.answer_when "always" (a business's default) or
  "when_away" (a person's). When away, ansa answers if: away_since is set
  ("I'm away" on Home, owners; "I'm back" clears it), or now is inside the
  weekly away_hours (the opening hours' shape, in time_zone; a person's
  setup step 2 and Settings → Assistant), else after reply_grace_minutes
  (5, 10, 15, 30 or 60; null = never): the run sets conversations.
  assistant_due_at and answers "waiting"; the catch-up
  (services/assistant-due.ts) claims due conversations in ONE UPDATE each
  (scalar SKIP LOCKED subquery, across companies) from /api/cron/publish
  (after posts, before post numbers), the daily job (after posts), pnpm
  telegram:poll and pnpm assistant:catch-up (development), each only while
  its slowest answer fits the 300 s, and answers the newest message unless
  you answered after it (a person's reply in ansa, or the restaurant's own
  Telegram message, which also clear assistant_due_at). contacts.important
  (anyone in the company, on the conversation page): ansa never answers
  them itself; it hands over at once with "important_person", no AI asked.
  "While you were away" on Home: the assistant's replied / drafted /
  handed_over lines since the person last pressed "Got it"
  (away_summary_reads, per company and person; the last day before the
  first), each conversation once. The sidebar's foot says "Away: ansa
  answers for you" or "Available: you answer" in when_away mode.
  - Home's "What ansa did": the newest six lines of ansa's activity, each a
    link to its conversation.
- Orders (step 52, /orders; Orders in the sidebar and the phone bar after
  the Inbox, only for a business that takes orders here:
  components/company-section-links.tsx reads the session inside
  <Suspense>, the links without Orders meanwhile). orders: one order of
  one conversation (same-company foreign keys on the conversation and the
  person who last moved it), status proposed / new / accepted / ready /
  done / cancelled, fulfilment delivery / pickup, the address (delivery
  only, a CHECK) and the customer's notes ENCRYPTED (orderFieldContext),
  wanted_time (one plain line, "As soon as possible" when not said),
  currency, subtotal + delivery fee = total (CHECKs; the fee only on
  delivery), summary_message_id (no foreign key: a message deleted in
  Telegram goes), order_number per company and placed_at exactly once
  placed (CHECK; unique per company), and one "proposed" per conversation
  (a partial unique index). order_items: the dish's name and price COPIED
  when the order was written up (a later menu change never changes an
  order), quantity 1-50, line total = quantity x price (CHECK), deleted
  with a proposal written up again. assistant_settings.delivery_fee_cents
  (Settings → What it knows and setup step 4, typed as a price in the
  currency, parsePrice; empty = free).
  - The assistant (step 49's run) collects an order: its answer names
    dishes ONLY by today's menu labels (M1...) and how many, delivery or
    pickup, the address, when, notes (lib/assistant/answer.ts, its rules
    lib/assistant/order-prompt.ts, which also gives it <order_in_progress>
    and this conversation's newest 3 <placed_orders>). ansa decides
    (lib/order-steps.ts, pure): a person's account, or a business that
    takes no orders here = handover "order"; closed now by its own hours =
    ansa's fixed "we can't take orders right now (opens at 18:00)"; a
    label not on today's menu or a count outside 1-50 = handover
    "order_unclear"; a missing way or address = ansa's fixed question
    (lib/orders.ts orderQuestion); else ansa prices it (priceOrder: the
    same dish twice is one line, the fee only for delivery) and writes the
    summary itself (orderSummaryText: every line, the fee, the total, how,
    when, notes, "Reply yes to confirm"). The AI never writes a total: its
    reply text is never sent on an order answer.
  - The summary is saved with the order ("proposed", replacing the one
    being written up) in ONE transaction that checks the conversation
    again (db/order-proposals.ts, saveOrderProposal); it goes out at once
    or waits in "Ask me first" like any reply. The customer's yes
    (order_confirmed) places the proposal ONLY when its summary reached
    them (sending, sent or unclear: not a draft or discarded), under the
    company row lock first (then the conversation's), with the next number,
    status "new", ansa's fixed confirmation sent at once (never waits) and
    an "order_placed" activity row; no proposal = handover order_unclear.
    Then the owners are alerted (services/order-alerts.ts: number, who,
    where and ansa's total, a link to /orders; never the dishes or the
    address). Their no (order_withdrawn) deletes the proposal with ansa's
    "No problem: nothing was ordered." A placed order they want changed or
    cancelled = handover "order_change".
  - The Orders page (services/orders.ts; everyone in the company, the
    person read again FOR SHARE, inbox-changes limit; it refreshes itself
    every 20 s while in view, components/refresh-every.tsx): "To do" (new,
    accepted, ready; oldest first, 100) and "Finished" (newest 30), each
    order with its lines, fee, total, how, when, notes and its
    conversation. One button for the next step: Accept (new), On its way /
    Ready to pick up (accepted), Done (accepted or ready), and Cancel
    ("Can't take it" while new; asks first). The status is checked in the
    UPDATE (db/order-status.ts: a second press finds it changed), and the
    customer's short fixed message (lib/orders.ts orderStatusText) is saved
    in the same transaction as a person's message that doesn't take the
    conversation over, only when the chat may take one now
    (lockReplyRouteWithin: Telegram's 24 hours); otherwise the status still
    changes and the page says the customer wasn't told. Home's "Needs you"
    counts new orders ("N new orders to accept"), and a conversation's page
    lists that customer's orders.
- Calls answered live (step 55, core/internal/phone, docs/backend/modules/
  phone.md): someone who couldn't reach the person or the business talks
  with ansa turn by turn, answered by the SAME assistant as chats (details,
  menu, saved answers, instructions, core's checks, orders priced by ansa,
  handovers with a request and the owners' alert). The call is the caller's
  conversation (contacts.channel "phone", by their number's digits); their
  words and ansa's are its messages, encrypted. ONE door for every phone
  line: Start (number and name: the conversation, a live call in
  phone_calls, the greeting), Turn (the caller's words as text: ansa's
  answer), End (hang up). The practice phone is the development line; a
  production provider (Vapi, Twilio, Telnyx or LiveKit, chosen at launch:
  the 2026-11-03 decision) becomes another line, one file and a name in
  phone_calls_line_known, and the person's phone forwards calls it can't
  take to ansa's number.
  - A call reaches ansa only when the person couldn't answer: ansa answers
    whatever "Only when I'm away" says, never as a draft ("Ask me first"
    can't hold a caller). The AI answers EVERY turn of the call (the
    gate's OnACall: paused, taken over or a request open don't silence a
    caller on the line). The brain gets channel "call" (CALL_REPLY: effort
    medium): a warm, smart assistant on the phone, the caller's own
    language (Bangla included), one follow-up question when it needs more
    (who, what about, how and when to reach them; never their number: the
    call has it), short spoken sentences, never a silent no_reply, never a
    promise of a time, money or a decision. ansa's own order texts are the
    spoken ones (core/internal/orders: SpokenSummaryText, "say yes to
    confirm", no promise to message the caller later).
  - The greeting carries the AI label ("Hello! I'm Rafa's AI assistant.
    Rafa can't take your call right now. How can I help?"): it never
    pretends to be the person.
  - When ansa may not answer on anyone's behalf (paused, a person handling
    the conversation, a caller marked important: CallTakesMessagesOnly)
    the AI only takes a message (call_mode "message_only": no answers for
    them, no order), each turn counted on the call; past the call's limits
    (60 turns an hour per caller, the business's hourly answers) fixed
    words take it, no AI. A handover doesn't end the call: the caller hears
    the AI's own words when they pass core's checks (else the holding
    reply, or "I'll pass that on" once a request is open), and a request is
    opened only when none is open (one per call at most). At the end, a
    request "A caller left a message" (reason call_message, routed, owners
    alerted: "ansa took their message on the call") for messages taken,
    unless one is open; then the phone.call_summary job has the AI write
    the call's note (who, what, how and when to reach them, in the call's
    language): added to the open request's description ("After the call:
    ...", within its 10,000 characters), giving a request ansa opened
    during that call the note's subject (never over a subject changed
    before; history "ansa updated the subject after the call"), or opening
    a request when someone has to act. The caller's own words stay in the
    encrypted conversation; a request carries the AI's short summaries
    only, as a chat's does.
  - Only the assistant answering a live call speaks into a phone
    conversation: chat.RouteWithin refuses it to everyone else (a person's
    reply, an order's status message); requests from a call are channel
    "phone". One live call per conversation (a partial unique index).
  - The practice phone (Settings → Connections → practice phone,
    /settings/channels/practice-call; owners; development only, refused by
    core in production): pretend to be a caller in English or Bangla, talk
    or type, hear ansa with the browser's voice of the words' language
    (lib/practice-phone/speech.ts; none for Bangla in Chrome on a Mac: the
    words are shown, the page names Edge). Hearing: the browser's speech
    service where it has one (the default; Chrome's is Google's, so the
    voice goes to Google; development only, the owner's own practice
    calls), which sends words; or "Whisper on this computer": a recording
    (16 kHz mono WAV made in the browser, lib/practice-phone/recording.ts)
    heard by whisper.cpp through the brain (/v1/voice/transcribe with the
    language en / bn / auto, development only, locked down like Claude
    Code: WHISPER_MODEL_PATH, WHISPER_CLI_PATH). 30 calls and 300 turns an
    hour per company.
- A GET route handler that reads no params is prerendered at BUILD time unless it
  calls `await connection()` first; lib/core-api.ts does that for every call
  to core, so nothing that asks core is built ahead. Check the build output:
  every /api route must show ƒ (dynamic). app/robots.ts and app/sitemap.ts
  call it too, so they use the running server's APP_URL, not the build's.
  Health, for an uptime monitor, is core's GET /health: 200 after one
  `SELECT 1` within 3 seconds, 503 when the database fails, never a body,
  and at most one check a second whatever the traffic (the answer is
  reused: httpserver.HealthCheck); the brain answers its own GET /health.
- The database pool (core/internal/database): at most 10 connections per core
  process, opening one gives up after 10 s, and an error's text is never
  logged (it can hold the database address). Never put statement_timeout or
  other settings in the connection string: they go on the database role
  (docs/going-live.md, section 1).
- Adapter pattern for third-party software: core calls generic actions
  through one door per kind of work (core/internal/chat for messages to
  customers, email, files, mediagen, platforms for social posts), and each
  vendor's translation lives in its own package or file behind that door. A
  first shop or helpdesk vendor (step 20: getOrder, getCustomer,
  createTicket) gets the same: one door, one file per vendor.
- No CQRS, no event sourcing, no DDD layers. Keep it boring.
- Folder shape:
  /app, /components -> the screens: pages, forms, thin route handlers (max ~15 lines each)
  /lib              -> the screens' helpers: lib/core-api.ts (the one door to
                       core) and lib/core-views/ (one file per area)
  /core             -> Go: cmd/ (the service, the operator's and the development
                       commands) and internal/<module>/ (all business logic,
                       and the only code that queries)
  /brain            -> Python: the AI thinking, one folder per use
  /db               -> the Drizzle schema and its SQL migrations (nothing queries through it)
  /docs/backend     -> the backend's docs: architecture, security, one page per module

## RULE 1: SECURITY IS NON-NEGOTIABLE
- Tenant isolation enforced in core on every query (see Architecture rules), no exceptions
- Never trust company_id from the client. Always take it from the login session core
  reads itself (or, for a webhook, from what only ansa issues).
- Validate every input before it touches the database: core checks every field
  (Go structs with checks; unknown fields from the screens refused), the brain
  with Pydantic; the screens' Zod schemas only check their forms first
- Never log API keys, tokens, phone numbers, call transcripts, or recording URLs,
  anywhere, including error logs. Database errors contain query values, so log
  only an error's class name in code that handles call data.
- All secrets in .env.local (the screens) and .env.core (core and the brain) only,
  both git-ignored; in production, the host's settings. Never hardcode. Never
  commit .env*
- Encrypt stored third-party OAuth tokens at rest
- Claude API: send the smallest slice of customer data that does the job, never a
  whole transcript when less will do. Never log the prompt, Claude's raw response,
  or SDK error messages (they can quote the response).
- Verify webhook signatures on every incoming webhook (core's: Vapi, Resend, Stripe, Telegram, Meta) before parsing
  anything: read raw bytes for the HMAC only. Unsigned or badly signed requests get
  401 and the only log line is the rejection.
- Rate limit all public endpoints (counters stored in a Postgres table, no Redis)
- Parameterized queries only: values go apart from the SQL ($1, $2, ... in core).
  Never build SQL from user input. Never string-concatenate SQL.
- Files (call recordings, uploaded docs): private R2 bucket, short-lived presigned URLs only, never public
- Core and the brain: docs/backend/security.md has their rules; re-read it before
  every change there
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
- Everything about ansa stays on my laptop only. Never publish or upload any of
  it: no artifacts, docs, design canvases, gists, shared links, uploads or
  git push. Plans and reports are local files (outside the repo when they are
  not code). Web research uses generic questions only, never ansa's code or plans.

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

Co-Founder (the second module, from the "Unified AI Business Platform" brief;
IMPLEMENTATION_PLAN.md has each step's evidence and what stays BLOCKED):
34. Company knowledge base, shared by support and the Co-Founder
35. Knowledge during live calls (a Vapi tool). BLOCKED for a real call (no Vapi account)
36. Business profile and onboarding interview
37. Marketing strategy from confirmed facts
38. Content studio (drafts per platform, claims, approval)
39. Media library and generation jobs (image service OPEN)
40. Social account connections. BLOCKED until ansa has each platform's developer app
41. Publishing queue, calendar, approvals and activity log
42. Analytics and evidence-based recommendations
43. One product: navigation, Business overview, docs, end-to-end verification

The assistant for restaurants (approved 2026-10-31, see the Decisions log;
the plan with screens and each step's checks is the owner's local file
~/Documents/business/ansa-assistant-plan.html, not in the repo). Replies are
Automatic by default; "Ask me first" is an option:
44. New look and app shell: sidebar and phone bar (Home, Inbox, Content, Settings)
45. Restaurant setup: business kind, address, hours, delivery, instructions, reply mode
46. Menu: items with prices, typed or read from a photo or PDF
47. Inbox: contacts, conversations and messages; calls and emails as conversations
48. Telegram (a Telegram Business chatbot on the restaurant's account)
49. The assistant replies on its own, with holding replies and owner alerts
50. ansa for one person ("Just me"): a person's setup, prompt, AI label and holding reply
51. Only when I'm away: "I'm away", away hours, "if I haven't answered within N
    minutes", important people, and "While you were away" on Home
52. Orders, with totals worked out by ansa
53. Facebook Messenger. Real customers BLOCKED until Meta's App Review
54. Weekly Facebook post suggestions with owner approval
55. Phone calls follow the account's settings (a person forwards unanswered
    calls to ansa's number). Real calls BLOCKED (no Vapi account)
56. WhatsApp Business: customers' messages (and calls, if Meta allows it)
    answered as on Telegram. Real customers BLOCKED until Meta's approval
57. Packages and usage limits (names, limits and prices: the owner decides)
58. Website, clean-up of hidden pages, final checks

Steps 50 and 51 were added on 2026-11-01 by the owner's direction: ansa is a
representative that answers for you when you can't, for a business (its
customers) or for one person (their shadow). The old steps 50 to 55 became
52 to 57; decision log entries keep the numbers they had at the time.
WhatsApp Business was added as step 56 on 2026-11-03 (the owner's yes):
packages and the website became 57 and 58.

Every outside service gets a local stand-in (like .dev-emails/), so each step can
be built and tested before the real account exists.

Do not jump ahead. Finish step N before starting step N+1.

The backend rewrite (Go core + Python brain, approved 2026-11-01) ran beside
this order and is done on the laptop, deploying aside
(docs/backend/migration-plan.md).

## Known gaps (revisit later)
- An address someone else took first (and never confirmed) stays blocked until its
  inbox owner takes it back with a password reset. Taken by a signup: reset, log
  in, then confirm with the new link + that password; they get the squatter's
  company (empty, renamable). Taken by joining through an invite (an owner
  inviting someone else's address, or a typo): the reset link removes that account
  instead, and the address is free to sign up or be invited again. Nothing stops
  that owner from squatting it again the same way before then (each time costs an
  invite). Other unconfirmed accounts (except teammates an owner removes), and
  empty companies, are never deleted.
- An unconfirmed teammate who joined through an invite and resets the password
  before confirming loses that account (see above) and needs a new invite.
- Changing your email address (which is also your login) is not possible yet. It
  needs a flow that confirms the new address first.
- Login limits: anyone failing 100 logins an hour for an address, from about 11
  IPv4 addresses or IPv6 /64 networks (or from one machine with a faked
  x-forwarded-for, until hosting is picked), keeps every browser that never logged
  in to that account out of it, and can renew that every hour. That covers a new
  device, cleared cookies, and a shared computer where someone else logged in last
  (the known-device cookie remembers one person per browser). Browsers the person
  logged in with before, and existing logins, keep working. A CAPTCHA for unknown
  browsers would close the rest (not decided). Someone behind an office's IP
  failing 100 times in 15 minutes blocks that office's new logins. A password
  reset doesn't clear the limits: someone who failed 10 times in 15 minutes from
  one place still waits out those 15 minutes after resetting.
- A login can't be extended: everyone logs in again 7 days after logging in. There
  is no list of devices, only a count and "log out on all other devices".
- Signup can still reveal whether an address has an account: sign it up, then log
  in with that password ("confirm your email first" = it was new, "incorrect" = it
  existed). Each probe creates an account, emails the address and counts against
  the signup limit (10/hour per IP). Both signup paths now send an email, so their
  response times are close, but they are not padded to be equal.
- One email address = one account = one company, and nobody can leave a company or
  delete their own account. Inviting an address that already has an account
  goes nowhere: the invite stays pending and the address is emailed to use a
  different one.
- Removing a teammate (step 23) keeps them as "Removed", and their address stays
  taken everywhere (users.email is unique across companies): they can't be
  invited again or join another company. There is no restore button; clearing
  users.deactivated_at by hand brings them back without their categories,
  invites or password (they choose a new one with "Forgot password"). Only
  accounts that never confirmed are deleted (by an owner's Remove, or the inbox
  owner's reset link), which frees the address.
- A company whose only owner leaves without making someone else an owner first
  (there is no transfer step: make the new owner, then they make you a member)
  has nobody to run billing, setup or the team until ansa changes a role in the
  database.
- A login that slips in at the very moment someone is removed can leave a session
  row behind until it expires (7 days); core's session reader
  (core/internal/session) refuses it on every request, so it opens nothing.
- The IP used for rate limiting comes from X-Forwarded-For's first entry:
  the screens read it for the login pages' limits and send it on to core
  (lib/request-ip.ts), and core reads it itself for its webhooks (else
  X-Real-IP, else the connection's address: core/internal/httpserver). That
  header is only trustworthy behind a host that overwrites it (Vercel,
  Cloudflare). Check both hosts when hosting is picked.
- Core's cleanup runs every hour (core/internal/maintenance): it deletes old
  rate limit counters, expired sessions, password reset links, social
  connection attempts and Telegram link codes, Telegram connections no code
  named, and core's own finished jobs 30 days after they ended, in batches
  of 10,000 for at most 10 seconds per table per run. A flood bigger than
  that takes several runs to clear (the log says "maintenance: cleanup
  stopped at its time limit"). Nothing else is ever deleted automatically
  (no data retention policy yet for calls, emails or tickets). No scheduled
  job runs stuck emails and calls again any more: each is a job of its own,
  tried again by itself (a call 3 times within about 3 minutes, an email 5
  times over about 45 minutes), and handed back after its 10-minute lease
  when cut off (an email cut off waits a little longer, below).
  One whose tries all failed (a database outage) waits for someone's
  "Process again" on the Emails page or "Analyze now" on the call (Home
  counts stuck emails; the Calls list says "Stuck: analyze now").
- Core runs as production unless ANSA_ENV is "development" (a missing
  ANSA_ENV counts as production, and core's "core started" line names its
  mode); only development allows the stand-ins (stand-in accounts and
  chats, Billing's simulate buttons, and .dev-emails/ and .dev-files/ while
  real email and R2 are off). In production core refuses to start without
  SEND_REAL_EMAIL=true and USE_R2_STORAGE=true (core/internal/config). What
  development wrote is never moved: emails in .dev-emails/ count as sent and
  are never sent later (an owner reopens and solves to send one), and files
  in .dev-files/ are never copied to R2 and can't be opened once
  USE_R2_STORAGE=true (docs/going-live.md, sections 2 and 3).
- Customer "solved" emails are retried by core: the delivery is a job saved
  with the solve, tried up to 3 times within about 3 minutes (safe: the row
  id is Resend's idempotency key), and a restart doesn't lose it. After
  that, or when the daily limit held it back, the email waits for someone's
  Retry on the ticket, which the page offers once no delivery is under way
  (10 minutes after it was queued or a send started). Such emails are
  listed on the Emails page ("Customer emails not delivered") and counted on
  Home. If Resend accepted an email we failed to record, a Retry more than
  24 hours after its first try sends it again: the page asks first, but
  can't know whether it arrived.
- Core stores each login's IP address and browser in the sessions table
  (Better Auth's format, kept) in plain text; only rate limit keys are
  HMACs. Changing BETTER_AUTH_SECRET resets every rate limit counter, and
  also ends every login and voids every emailed confirmation link and
  known-device cookie (core signs them with it).
- Bounces, spam reports, suppressions and Resend failures (steps 17 and 27) are
  recorded for customer "solved" emails only, not for verification or assignment
  emails. Such an email is shown on the ticket (and, except a spam report, on the
  Emails page's "not delivered" list) but never re-sent; fixing the address needs
  a reopen (owner) and solve. The reopened ticket keeps warning about it while it
  has that address. One company's bounce or spam report suppresses the address
  for every company (one Resend account). Such an event that arrives before
  "sent" is recorded (core/internal/resend/webhook.go matches only "sent" rows;
  email.suppressed can come at once) matches nothing and is answered 200, so it
  is lost: the email then shows as delivered.
- No error monitoring service yet, and nothing alerts anyone. Core writes
  one JSON line per event, a fixed name with safe fields only (a code, a
  count, a duration, an error's Go type: core/internal/logging), never an
  error's message, which also hides it from you: debug with what the line
  gives, or reproduce locally. A failed job also keeps its code on its
  core_jobs row for 30 days. The screens log a failed request as one
  data-free JSON line ("event":"request_error", lib/error-reporting.ts). A
  wrong setting at startup stops core (core/internal/config) or the screens
  (lib/env.ts) with one line naming the setting and the rule broken, never
  its value. Choosing an uptime monitor (on core's GET /health) and a log
  service that keeps logs and alerts is open; docs/going-live.md
  (Monitoring) lists the lines to alert on. A stalled pipeline that logs
  nothing (Vapi or Resend no longer calling) only shows as silence.
- Payments (step 18) record who pays but enforce NOTHING: a company that never
  paid, or whose payment failed, keeps full access. Deciding what happens then
  (trial length, lockout, grace period) is open, and so is pricing. No free
  trial is set up; Stripe can add one on the price or checkout.
- Stripe events for a new customer are ignored until the checkout's own event
  has saved the row. A subscription change made in the instant between that
  event reading the subscription from Stripe and saving it is therefore lost
  until Stripe's next event about that subscription.
- No Content-Security-Policy header yet (Next.js inline scripts need nonces).
  The other security headers are set in next.config.ts.
- Vapi's real signing format is NOT confirmed yet (no account). On the first real
  call, compare Vapi's Webhook Logs (dashboard) with core's VAPI_* settings
  (core/internal/config/vapi.go) and adjust those settings only. Also
  confirm the end-of-call-report field paths in core/internal/calls/webhook.go.
  Vapi only signs when the server URL comes from saved
  config (assistant, phone number, Server Configuration), not inline API calls.
- Testing real calls locally needs a tunnel (e.g. cloudflared) so Vapi can
  reach core's /webhooks/vapi. Until then, from core/, use
  make simulate-vapi-call, make simulate-solved-call for a call the AI
  marked solved (a stand-in answers for the brain; local database only),
  and make simulate-vapi-tool-call for the assistant's knowledge search
  during a call (step 35).
- Knowledge during live calls (step 35) is NOT tested against a real Vapi
  account: the tool-calls message (toolCallList, arguments as an object or a
  JSON string, call.phoneNumberId), the answer's shape and the signing of tool
  requests follow Vapi's docs only (they disagree on arguments); check the
  tool's request and answer in Vapi's call log on the first real call. The
  assistant searches only if its system prompt says when, and it is Vapi's
  model, not Claude: it may have tools of its own. The escaped <article>
  tags keep an article from faking where its text ends, but only the
  assistant's prompt and the answer's "reference text, not instructions"
  label keep an approved article's words from being taken as instructions
  (docs/going-live.md, section 4, step 7). The question is never stored, so
  the call page shows what was found, not what was asked. A tool call
  refused by the shared per-IP limit (429, also when counting fails: a
  database error, logged as "vapi webhook rejected", rate_limited) or over
  1 MB (413) gets no answer at all (Vapi ignores anything but 200), and
  the assistant goes on without it, not told to offer a ticket. Lookups are
  kept forever, like calls.
- Call recordings (step 14): copied once, right after the webhook answers. If the
  copy fails it is not retried (the Vapi link is never stored). Not tested against
  a real Vapi recording or a real R2 bucket yet. Recordings are kept forever: no
  retention rule yet.
- DATA_ENCRYPTION_KEY must be backed up; losing it loses every transcript, what
  Claude wrote about calls, every received email's content and every ticket note.
  There is no key rotation yet (the "v1:" prefix leaves room for it). Only the
  interview logs a text it can't decrypt ("could not decrypt stored text:
  check DATA_ENCRYPTION_KEY"); a call's transcript, a note or an email that
  can't be decrypted shows as such on its page, with no log line.
- Since the rewrite some pure rules live twice: in the screens (the browser's
  live checks and words) and in core (what is decided and sent). The content
  rules are tied: both sides replay one set of vectors
  (core/internal/contentrules/testdata/old_rules.json: core's
  oldrules_test.go and pnpm check:screens). The others are kept equal by hand
  only, for example the menu's price reading, the setup lists, Telegram's
  fixed texts, the publishing limits, the metric definitions and the link
  lifetimes (the screens' comments name core's copy).
- Setup page (step 16): owners list their support addresses there (shown, and
  used to skip mail from the company itself). Phone numbers are linked by ansa
  (make link-phone-line in core/; make unlink-phone-line works only before
  a number's first call) and shown read-only by their Vapi id with their
  last call: the number customers dial is not stored. The checklist marks
  email and phone done only once an email or a call has arrived. Uploaded
  documents (PDF, .docx,
  .txt, .md, .csv, max 4 MB each, at most 100 files and 200 MB per company,
  checked before each upload, so two at once can go over by a file) are stored
  and listed; the AI never reads a file itself: "Add to knowledge" (step 34)
  turns its text into draft knowledge articles. Server actions
  accept up to 5 MB bodies (next.config.ts) for uploads; Vercel caps requests at
  4.5 MB, so larger files would need direct-to-R2 uploads. The upload form
  refuses a file over 4 MB in the browser, so such a file is never sent (with
  JavaScript off it is sent, and refused with an error page).
- What Claude reads of an email is cut by known patterns (brain/brain/email/
  own_text.py): signatures without a "-- " line (most Outlook and Apple Mail
  ones: name, title, phone; and all of them in text made from HTML, where
  that line loses its space) still reach it, as do phone numbers and quoted
  threads in formats or languages it doesn't know. With text above it, an
  unquoted thread (made from HTML) is cut whole, so a reply written below it
  is lost to Claude (the ticket keeps everything). The customer's own words
  can still look like a marker and hide what follows from Claude: a line
  like "On Monday at 10:00 I wrote to you:" (an "On ... wrote:" with a clock
  time or address), a From:/Date:/Subject: block, or a dashed line with
  "original" or "forward" in it.
- Email channel: the AI does NOT reply to customers by email. It only triages into
  a ticket. Letting the AI answer emails on its own needs (a) the company's
  knowledge (step 34, approved articles) and (b) your decision on auto-send vs. draft for an
  expert to approve. No acknowledgement email is sent either. Attachments are
  only counted and named, and images shown inside an email only counted:
  nobody at the company can open them (Resend keeps them; storing them in R2
  needs size limits and a decision). The text made from an HTML-only email is
  a simple tag strip: a ">" inside an attribute shows the rest of that tag as
  text, a <title>, <style> or <script> that is never closed hides everything
  after it (the ticket then says no text could be taken from the HTML). If
  fetching the content still fails after 3
  tries, the email is "content_unavailable" with "Process again" on the Emails
  page, which fetches from Resend again and works only while Resend keeps the
  email (its retention is not confirmed). Not tested against a real Resend
  account yet.
- Mail that arrives through a mailing list (List-Id, List-Unsubscribe or
  Precedence: list) is skipped as bulk mail, unless the List-Id names one of the
  company's listed support addresses (its own Google Group). A group under
  another address, or one the owner never listed on Setup, has every customer
  email skipped: they show on the Emails page with "Make a ticket anyway". So
  does mail From a listed support address that isn't the group passing on a
  customer's email (From rewritten for DMARC, with one Reply-To naming the
  author): a group that leaves the author out of Reply-To, or a mailbox rule
  that forwards as a new message, needs "Make a ticket anyway" for each email.
- An email with one Reply-To that differs from From gets no customer email filled
  in, even from a verified sender: a contact form's relay sends from its own
  address. An expert picks the Reply-To or the sender on the ticket. A customer
  whose own mail program sets a different Reply-To gets the same treatment.
- An email whose processing was cut off (a crash, or a deploy that outlasts
  core's 20-second stop) stays "processing" until its job comes back after
  its 10-minute lease; the email may be claimed again only 15 minutes after
  its run started, so the job keeps trying (5 tries, waits of 2 and then 8
  minutes) and processes it about 20 minutes after the cut. Meanwhile the
  Emails page lists it as stuck after 15 minutes ("Process again") and Home
  counts it. A call cut off the same way is analyzed again by its job (its
  claim waits only 5 minutes). Two runs of one email no longer overlap: a
  run ends with its job's lease.
- Forwarding (step 24) is not tested against a real Resend account. Before
  launch, forward ONE real email (Gmail or Google Workspace) to a forwarding
  address and check in Resend's dashboard which field carries that address:
  normally `to`, but in May 2026 Resend showed the original To header there by
  mistake (since reverted). The code reads to, cc, bcc and received_for, so either
  works; if none carries it, the email is dropped with "inbound email
  ignored" (no_forwarding_address) in the logs. Gmail's forwarding
  confirmation is expected to become a ticket (the
  owner clicks its link there); if our filters take it for automatic mail, Setup
  says it did not become a ticket and tells the owner to contact ansa, whose
  operator reads the code in Resend's dashboard (owners can't). The checklist's
  email item only says that an email arrived: Gmail's confirmation, or a
  customer's reply to a "solved" email, counts too, before forwarding works. One
  delivery addressed to two companies' forwarding addresses is ignored for both.
- A forwarding address is effectively public: it is the Reply-To of every
  "solved" email of a company without its own reply-to address. Mail sent
  straight to it skips the company's own spam filter, and the only flood control
  is 10 tickets an hour per sender, so a spammer who changes the From address
  each time can open as many tickets as they like. Above 100 emails an hour per
  company Claude is skipped (no Claude call and no category, so no routing and
  no assignment email), but every email still becomes a ticket: there is no
  per-company cap on tickets, and no per-domain limit. Companies can't change their
  address; ansa's operator can (make replace-forwarding-address in core/),
  and then the old one stops at once: the company must forward to the new
  one (Gmail asks to confirm again), and replies to emails sent before no
  longer arrive.
- A customer's reply to a "solved" email (it goes to the forwarding address when
  the company has no reply-to) becomes a NEW ticket, routed like any other
  (maybe to another expert), with no link to the solved ticket, which stays
  solved. Threading replies (subject "#<n>" plus sender = that ticket's customer
  email, same company) and what to do then (attach, reopen, notify whom) is an
  open decision. Before step 24 these replies went to EMAIL_FROM and were lost.
- Calls that fail to save are lost for good: a 500 (database blip), 413 (report
  over 1 MB) or 400 (unexpected shape), a 429 from the one per-IP limit all of
  Vapi's traffic shares (10,000 a minute; docs/going-live.md says to have Vapi
  send end-of-call-report only), and calls to a number nobody linked (only
  a log line). Vapi doesn't retry, and nothing compares our calls with Vapi's call
  list yet (that needs a VAPI_API_KEY and the real API format). Setup shows each
  number's last call, so a wrong link or a silent stop is visible.
- Call brain quality is unmeasured: no eval set yet. Collect real calls, then
  tune the prompt, effort and model against them before trusting "solved".
  Since step 31 a wrong "solved" that a teammate escalates is counted (solved
  calls with calls.escalated_at), but only when someone opens that call: solved
  calls are not queued for review, and no page shows the count yet (query the
  table). Calls decided before step 31 show no confirming sentence.
- The "solved" guard (step 28) errs toward a ticket. A confirmation in the
  first 4 turns never counts, so a 5-turn call (greeting, question, answer,
  "That worked, thank you so much.", goodbye) always gets a ticket, as does
  every call of 4 turns or fewer. Nor does a confirmation that isn't one
  whole sentence of 3+ words ("Yep." "Works now."), one next to a "..."
  ("Okay... that fixed it."), one whose sentence runs on after "Dr." or
  "e.g." or into a word in small letters ("Done. thanks, it works."), or a
  statement that starts like a question, also after "So" or "Okay," ("Did
  that fix it", "Okay, was the cable, works now"). It can't judge meaning: a
  whole closing sentence like "No, that's all." passes it when Claude says
  solved, and so does a confirmation the customer takes back later in the
  same turn if Claude misses it (the slice always shows the end of the last
  two turns).
- The transcript parser assumes Vapi's "AI:" / "User:" labels, one turn per
  line. Confirm with the first real transcript
  (brain/brain/calls/transcript.py). A transcript that arrives as one line
  still splits on a label said mid-sentence. Phone numbers said in a call
  are not redacted from the slice.
- Transcript slices are sent to Anthropic, which keeps API data for a limited
  time by default, and so are the Co-Founder's interview messages, business
  facts and the knowledge articles an owner picks (step 36), and what a
  marketing plan is made from (step 37: confirmed facts, approved marketing
  articles, the owner's note, the newest performance review's findings and,
  if allowed, ticket counts per category), and what a performance review
  reads (step 42: each post's topic, platform, format, pillar, weekday and
  hour, and its numbers), and a menu an owner reads in (step 46: the photo
  or PDF itself, or the text of a Word file or of what was pasted). Zero
  data retention is an org-level arrangement
  with Anthropic.
- The system prompt is too short for prompt caching to apply, so it isn't cached.
- Tickets from calls have no customer email (we never extract one from a
  transcript: a misheard address would leak details to a stranger), so the
  "solved" email (step 5) does not go out for them until an expert enters the
  customer's email on the ticket (step 9). The same goes for email tickets whose
  sender is not verified (step 25), or whose email names a different Reply-To
  (step 27).
- Resend's `authentication` field is NOT confirmed on a real account (step 25).
  The code expects { spf, dkim, dmarc }, each "pass", "fail", "gray",
  "processing_failed" or "unknown", and trusts dkim "pass" to mean a signature by
  the From address's own domain. Anything else counts as not verified, so with
  a different real shape every email ticket would wait for an expert to confirm
  the address. Before launch, check one real Gmail email, one forged-From email
  and one with a second address in the sender's name in Resend's dashboard (see
  docs/going-live.md).
- Email tickets created before step 25 kept the sender as customer email without
  any check (no backfill; their inbound_emails.sender_verified is false).
- The 300-a-day customer email cap counts delivery attempts (a failure that is
  retried counts twice) in a fixed 24-hour window from the first one. Not built
  (open decisions): a cap on repeat "solved" emails per ticket, pausing a company
  with many bounces or spam reports, rules for URLs or domains in company names,
  and no customer emails before a company has paid.
- Adding a customer email to an ALREADY-SOLVED ticket sends nothing. Reopen is
  owner-only, so a member who adds an email to a solved ticket cannot trigger the
  "solved" email at all; only an owner can, by reopening and solving again.
  No "send now" button on purpose: build one only when this actually comes up.
- Changing a ticket's email never redirects an email already queued or failed:
  outgoing_emails.to_email keeps the address from solve time, and Retry uses it.
- Every escalation makes a ticket, including silent or abnormal calls. Expect noise
  (robocalls); filter by reason once real volume shows what to drop.
- Calls escalated before step 8 have no ticket (test data only, no backfill).
- Assignment emails (step 13) are best effort: core's ticket.assigned job is
  queued in the assignment's own transaction (not the outbox table), so a
  restart doesn't lose one, but a send that fails is only logged (no
  retry). There is no way to turn them off yet, and no in-app notification.
- Teammates who haven't confirmed their address get no categories, tickets or
  assignment emails until they do. Categories ticked for them before step 23 stay
  and start routing once they confirm. Open tickets they held before step 23 were
  unassigned by the migration (db/migrations/0017, hand-added UPDATE), not routed
  again: they wait in the Unassigned view until someone assigns them, or someone
  picks (or an owner restores) their category, which routes them (step 29). A
  mistyped invite's account shows as "Not confirmed yet" on the Team page until an
  owner removes it.
- Load counts only open tickets; it ignores ticket size, time off, or skill level.
- Repeat customers (step 29) are matched only on the ticket's own customer phone
  (7+ digits, not a hidden caller's placeholder) and customer email. An email
  ticket's sender counts only once it is verified or an expert confirms it, so
  unverified senders never follow their earlier ticket (search still finds them
  by the From/Reply-To on the email).
  Caller ID can be spoofed: a spoofed number lands on that customer's expert and
  shows that customer's other open tickets on the ticket page (team only). The
  match overrides category routing, so an expert can get tickets outside their
  categories, robocalls from one number included, until the open ticket is
  closed. Tickets are linked, never merged. Routing accuracy figures
  (routed_to_user_id vs. assignee or solver) cover both rules together:
  routed_to_user_id doesn't say which rule made the pick. Since step 30 the
  ticket's "routed" history rows do (a category, or empty for same customer).
- A caller who hides their number arrives with a placeholder: Twilio spells a word
  on the keypad (+266696687 = ANONYMOUS, also RESTRICTED, UNAVAILABLE, UNKNOWN,
  BLOCKED). Core's CustomerPhoneDigits (core/internal/tickets/manual.go)
  never counts those, or a number of one repeated digit, as a customer. Not
  confirmed with Vapi (no account): on the first real
  call from a hidden number, check its customer.number and add any other
  placeholder to that list. An unlisted one makes every hidden caller one
  customer: their tickets follow each other's expert and list each other.
- Routing waiting tickets (someone picks categories, a category is restored)
  queues one email job per new assignee in the same transaction, sent by
  core's workers after commit: a backlog of hundreds may meet Resend's rate
  limit, and a send it refuses is only logged (best effort).
- Search has no trigram index: ILIKE scans the company's tickets (and the senders
  of its received emails). Fine for thousands per company; add pg_trgm if it gets
  slow. Step 33's indexes cover the lists, views and lookups, not search.
- The per-view ticket counts (All requests) and the Calls page's counts read
  every ticket or call of the company on each view, about 10 ms per 100,000.
  A very large company would need stored counts.
- Core sets no statement timeout of its own: until one is set on the
  database role (docs/going-live.md, section 1), a runaway query runs on,
  holding its locks (maybe the company's row lock), until it ends by
  itself: core giving up on it (a request's or a job's time running out)
  only closes its connection.
- CI (.github/workflows/checks.yml: one job each for the screens, core and
  the brain, and an audit) has never run in this form: the branch holding
  it (rewrite/go-python) was never pushed, so this machine holds the only
  copy of everything after origin's last known main (2026-10-28; the
  repository does have that git remote). Its first run also tries the Go
  and Python jobs' action versions (actions/setup-go v6,
  actions/setup-python v6) for the first time.
- Ticket and call searches are plain GET (?q=), and the view links and
  Previous/Next keep it, so what was searched, often a customer's phone
  number or email, sits in the URL: the browser history and the hosting
  provider's request logs (and any log drain) keep it, and the screens pass
  it on to core in the address of their request (/api/v1/requests?q=,
  /api/v1/calls?q=), so whatever sits in front of core may log it too.
  Neither part's own logs hold it (the screens' error lines hold the route
  pattern only; core logs no address). Check each host's log retention when
  hosting is picked (docs/going-live.md). Keeping it out of URLs needs a
  POST search, and searches could then no longer be bookmarked or shared.
- The Setup checklist's "Everyone picked the categories they handle" counts
  owners too, so an owner who never takes tickets keeps it "to do", and Home
  keeps telling them "You don't handle any kind of request yet" (step 32).
  There is no way to say "I don't take tickets" yet. Home no longer lists
  the Setup steps left (the "easy to use" pass): only the Setup page does,
  and some are never done for some companies (no phone line, a one-person
  team, no documents).
- Tickets assigned before step 10 were marked "assigned by a person" by the
  migration (db/migrations/0009, hand-added UPDATE).
- Ticket history (step 30) starts with this step: older tickets show only
  "Ticket created" and their current state (no backfill). Notes can't be edited
  or deleted. The history says who set the customer email and when, not which
  address, and who changed the subject or the customer's name, not the old
  text. The ticket page shows the newest 200 entries only. Notes are typed
  into the browser and shown to the whole team: anything an expert pastes in
  (card numbers included) is stored, encrypted, like the rest.
- Someone whose category change, new ticket or escalation routes the ticket to
  themselves is still emailed about it (routing assigned it, not them). Changing
  that is an open decision.
- Only a ticket's subject and customer name can be edited (step 31): not its
  description, phone or channel. A mistyped phone on a ticket typed in stays,
  and the same-customer match (step 29) uses it. A ticket typed in has no
  attachments, and its phone is free text (not checked or normalized). An
  escalated call's ticket starts with the subject "Phone call needs follow-up"
  and no customer email, like a call ticket made by a rule. Two people changing
  the same field at once: the later save wins (the history names both).
- Reopening emails only a routed replacement (when the assignee can no longer
  take tickets). An assignee who keeps the ticket is not told it is open
  again, including someone given it while it was solved, who got no email then
  either (step 30). Whether reopening should tell them (with "it was reopened"
  wording) is an open decision.
- A ticket, call, knowledge article or plan version that doesn't exist (or
  is another company's) answers HTTP 200 to someone logged in: the page's
  notFound() runs inside <Suspense>,
  after streaming started (Cache Components), so only the page itself (and a
  noindex tag) says "not found". Logged-out visitors get a real 307 from the
  proxy, but a browser still holding the cookie of a session that ended gets
  the page's shell ("Loading...") and then a redirect to /login made in the
  browser.
- Tab titles: a ticket's tab shows its subject (for email tickets, written by
  the sender), a call's the caller number's last four digits, an article's
  its title, a content draft's its topic; browsers keep titles in their
  history (and sync it). Other pages have fixed titles.
- Dark mode (step 44) follows the device's setting only: there is no
  switch in the app to choose light or dark.
- The assign menu adds a teammate's email only when two people share a name;
  the ticket list shows the assignee's email on hover only.
- Knowledge (step 34): the phone assistant reads it during live calls
  (step 35) and the chat assistant with each reply (step 49: the best 3
  approved support articles, within 3,000 characters); the call brain and
  email triage don't, and otherwise approved support articles only show on
  tickets and in "Test what the AI finds". The search matches words, not
  meaning (no embeddings,
  IMPLEMENTATION_PLAN decision 2): "refund" doesn't find "money back", and the
  stop words are English only. A scanned PDF has no text (no OCR). A web
  import is that one page (links are not followed, pages behind a login or
  built by JavaScript give little or nothing), and no import is ever
  refreshed when the document or page changes: importing again adds new
  drafts beside the old ones, which stay until someone deletes them. A PDF's
  text is read by the brain (pypdf, at most 1,000 pages and 400,000
  characters): a hostile PDF can still make that slow or memory-hungry there
  (a .docx's text part is unpacked by core under a 50 MB cap). What someone
  types or pastes into an article,
  customer details included, is stored in plain text and, once approved,
  could be quoted to any customer: only the notice on every form stops it,
  and "Save as knowledge" starts the title as the ticket's subject, which can
  hold a customer's name. The GIN index holds every company's pieces (a very
  large platform would want btree_gin on (company_id, search_vector)); the
  title search on /knowledge is ILIKE with no trigram index. Two people
  editing the same article: the second save is refused and must be redone by
  hand (no merge). The search needs ICU's "und-x-icu" collation in Postgres
  (docs/going-live.md, section 1).
- Co-Founder (step 36): the marketing plan (step 37) and the content
  studio (step 38) use the facts. The interview's quality is
  unmeasured (no eval set): Claude may miss or misread a fact, which only
  becomes a proposal an owner must confirm. Claude reads the newest 12
  messages only: something said earlier and not proposed then is lost to it
  unless the owner says it again. Without an API key, or while Claude fails,
  nothing is proposed and the same fixed question comes back until an owner
  fills that topic in on the Profile page. Two answers at the same moment
  (two owners or tabs) are both saved and their replies may interleave; an
  answer to the first question from a page opened before another owner
  started the interview joins that conversation. A proposal doesn't say
  which article it came from, and the profile keeps no earlier values (only
  who confirmed the current one, and when). Business facts are plain text
  and go to Claude: an owner typing a customer's details or a secret into a
  fact stores it in plain text (only card-like and social-security-like
  numbers are hidden from Claude); interview answers are encrypted, but are
  sent to Claude too. Messages are kept until Start over (no retention
  rule), and Start over deletes the whole conversation (no single message).
  "Suggest facts from knowledge" reads an article's first 10,000 characters
  only. Members can read but never add facts.
- Co-Founder strategy (step 37): no web research (IMPLEMENTATION_PLAN
  decision 10): a plan knows only the confirmed facts, the approved
  marketing articles, the note, the newest performance review (step 42)
  and (if allowed) ticket counts, so anything about the market is an
  assumption at best. Plan quality is unmeasured (no
  eval set): the code checks the shape, the limits and that a "Fact" names
  confirmed facts that were sent, not that the statement really says what
  they say, nor whether an assumption or a suggestion is sound (the page
  tells owners to check each point). Claude reads every confirmed fact
  whole (up to 25 of 2,000 characters) and at most 6,000 characters of
  articles, found by the first words of the products, services and goals
  facts, 20 in all, taken in turns (words, not meaning: a long fact's later
  words don't count). One long try (270 s, no
  retry): a passing Anthropic error or a slower answer means "Try again".
  Plans are kept forever (no cap but the hourly limit, no delete, no
  retention rule), and are never remade on their own when facts change (the
  page says when they did). Support trends count tickets by the category
  they have now (a rename is followed, an archived category still counts),
  created in the last 30 days, without the uncategorized ones, reading the
  company's tickets on each plan (no index on created_at). Plans cover
  LinkedIn, Facebook, X and YouTube only (the platforms step 40 connects):
  Instagram or TikTok can only be named in a text. The content studio (step
  38) reads the current plan's positioning, audiences, pillars and
  campaigns; no performance review is sent to it (step 42's goes to the
  planner only).
- Content studio (step 38): X's length is counted as X's own library does,
  approximately: only words starting with http://, https:// or www. count
  as links (23 each; X also shortens a bare "example.com", counted here
  letter by letter), and an emoji is a grapheme holding a pictographic or
  flag character (a keycap or a rare symbol may count differently).
  LinkedIn and Facebook are counted in Unicode characters (an emoji of
  several, a flag or a skin tone, counts each: a little high, never low).
  The "see more" cut of the preview is roughly where each app cuts. Claims
  are only as good as the model's list: a claim the AI didn't list is
  checked by nobody (the owner's tick says they read the text; a text
  changed or written by hand always needs it, since no code lists its
  claims), and "backed" means the claim names confirmed facts that were
  sent, not that it says what they say. Words to avoid match whole words
  and phrases only ("cheap" never finds "cheapest"), a sentence in the fact
  stays one phrase (the page lists what is looked for), and only an English
  "None"-like fact is read as no words. A post with an image or a video
  (all of YouTube) is approved only with its image or video attached from
  the media library (step 39). Platform and format are fixed when a draft is
  made. There is no history of earlier texts: a new version replaces the
  text (Regenerate asks first over a hand edit); the activity log (step
  41) records who approved, rejected, archived or restored a draft, not
  who edited it (the draft keeps its last changer). Drafts are
  kept forever (no delete: Archive; no cap but the rate limits) and are
  plain text sent to Claude with the facts: what someone types into a
  draft, customer details included, is stored and sent. Anyone can archive
  a draft an owner approved (its approval goes), as an edit would, and so
  does changing its image's alt text in the media library (step 39). Two
  people editing: the second save is refused, to be redone by hand. Words
  to avoid are looked for in the text as written: an invisible character
  inside or right after a word (a zero-width space or joiner, a variation
  selector) hides it from the check, and only the owner reading the text
  catches it. A one-line field (title, call to action, topic) drops the
  left-to-right and right-to-left marks with the other hidden format
  characters (punctuation in a call to action mixing directions may then
  show elsewhere); the text keeps them all.
- Error class names in the screens' production build: their code is
  minified, so a line lib/safe-error-logging.ts writes (an error named by
  error.constructor.name) may show a letter for an error of a library
  bundled into the screens; Node's own keep their names. Core names an error
  by its Go type (core/internal/logging, never shortened) and the brain
  names Claude's errors by the SDK's classes (brain/brain/ai.py), so the
  backend's lines are not affected.
- Media library (step 39): no real image or video service is chosen (OPEN,
  IMPLEMENTATION_PLAN.md decision 9, options and prices in
  docs/research/vapi-tools-media-anthropic.md), so production has no
  generation at all ("off", said on its pages) and development only the
  stand-in's flat-colour PNGs; no video is ever generated in development (an
  honest "no_video_provider"). The provider interface, polling, result
  downloads, claims and retries are checked with fake services only: no
  adapter has met a real API, and "cost" is whatever an adapter will report.
  A service's provenance marks (C2PA) are kept only as long as the bytes are
  stored as received (they are; nothing re-encodes them), and nothing reads
  or shows them. Uploads are capped at 4 MB (the request limit): real videos
  are usually bigger and need uploads straight to R2 (presigned PUT), not
  built. The library shows the files themselves, lazily, no thumbnails (a
  page of 50 big images is heavy); in development a video is sent whole
  without range requests (Safari won't play it; R2's signed links do
  ranges). Video sizes and lengths are not read, and an image's sides are
  read as shown only for a JPEG (its Exif orientation): a WebP or PNG
  carrying an orientation of its own (rare) keeps its stored sides. An image
  asked from a draft whose version moved on meanwhile (a teammate's edit, or
  new alt text, in another tab) only reaches the library: someone attaches
  it from the picker. A result that comes back to a library filled meanwhile
  (uploads don't wait for open requests) was made, and with a real service
  paid for, but is not kept ("library_full"). A stuck request is taken up
  again by core within a minute (or by "Start now"); a run whose
  service never answers the start in time fails ("provider_timeout"),
  although the service may have made (and charged) it, since there is no id
  to ask; a run cut off after the start but before the id was saved asks
  again (paid twice). Generation from a draft makes images for posts with an
  image only (a video draft's image description is its thumbnail, and a
  draft holds one file); videos are asked for on the media page and attached
  there. When a file delete fails after its row is gone, the file stays in
  storage with nothing pointing at it (logged, never retried). The media
  library keeps everything forever (no retention rule; caps: 300 files, 500
  MB per company); prompts and alt text are plain text, and a prompt goes to
  the image service once one is chosen: what someone types into it is sent.
  Alt text is stored for publishing (step 41) but no AI writes it.
- Social accounts (step 40) are BLOCKED on ansa's developer apps, all four:
  nothing has met a real platform, and every adapter is written from the
  docs (docs/research/social-publishing-apis.md) and checked with fakes.
  LinkedIn: needs ansa's app (Share on LinkedIn + Sign In with LinkedIn,
  self-serve); that /rest/posts takes such a token, that urn:li:person:<sub>
  is the author, and how hashtags and escaped characters show
  (core/internal/platforms/linkedin_text.go) are NOT CONFIRMED; member
  tokens end after 60 days (a reconnect, unless LinkedIn makes ansa a
  partner); post numbers need the Community Management API on an app of its
  own (legal entity, screencast);
  organization pages are not offered. Facebook: needs Meta App Review for
  each permission and Business Verification; only the first 100 Pages a
  person manages are offered; whether a Page token stops when Meta's 90-day
  "data access" ends is NOT CONFIRMED. X: needs pay-per-use credits ($0.015
  a post, $0.20 with a link); whether refresh tokens rotate is NOT
  CONFIRMED. YouTube: needs Google's verification (until then 100 users and,
  in Testing, refresh tokens of 7 days) and an audit past 100 uploads a day
  for all of ansa's customers together; whether unaudited uploads stay
  private is NOT CONFIRMED.
- Social accounts, otherwise: the queue (step 41) publishes only what
  PUBLISHED_FORMATS lists: videos go to YouTube only
  (LinkedIn's, Facebook's and X's upload flows aren't built), one image per
  post (X takes 4), and the stand-in mimics only which formats a platform
  takes. A renewal that finds the platform silent is retried at the next
  use, not on a schedule. A run that dies while renewing holds its claim
  for a minute: uses of that connection meanwhile wait 20 s and then "try
  again later". The page knows a refresh token's end only when the
  platform names one (Google in Testing): Google's six months unused and
  a revoke on the platform show only once ansa next renews. Disconnecting
  revokes at X and Google only: a LinkedIn member or a Facebook Page's
  admin removes ansa on the platform by hand, and until then the platform
  still lists ansa there. X and Google are asked only once no company
  still has that account connected (their grant is shared): until the last
  company disconnects it, the platform still lists ansa; whether X's
  revoke ends the whole grant or just that token is NOT CONFIRMED (treated
  like Google's). A company connecting the same account in the instant
  between that look and the revoke loses its new connection (it needs a
  reconnect). Removing a teammate, or making an owner a member,
  disconnects the LinkedIn profiles they connected, but not an X account
  or YouTube channel they connected (those may be the business's own, or
  theirs: an owner disconnects those by hand); a profile made a member's
  that way needs connecting again if they become an owner again. While
  both are owners, any owner may schedule posts to another owner's
  LinkedIn profile (they go out as that person, who sees the queue and can
  cancel them or disconnect it). Two returns from a platform
  for the same account at the very same moment (two owners, two tabs) save
  once each, the later one's tokens winning. A token that can't be
  decrypted (a wrong DATA_ENCRYPTION_KEY) leaves the connection looking
  connected while nothing can use it. Connections and their attempts are
  kept forever (the attempts until core's hourly cleanup: up to an hour
  past their 10 minutes); the platform's display name is shown as the
  platform gave it.

- Publishing queue (step 41): posts scheduled for later go out at the
  queue's next round, every 15 seconds while core runs with its scheduler
  on (CORE_SCHEDULER not "off"; a long round delays the next). The
  platforms' own scheduling (Facebook's, a private YouTube video's release)
  is never used: ansa's queue sends each post when it is due, so a post is
  as late as the next round. Nothing has
  met a real platform (step 40's gaps): the stand-in's posts are files and
  have no address. A run cut off between its claim and the platform call
  (a deploy, a crash) leaves the post "publishing", and 10 minutes later it
  needs a person's check although nothing was sent (a false alarm, by
  design: the run can't know how far it got); a run cut off mid-send is
  the same, and then the post may really be out. The pages show it as
  needing attention from then on, and the queue's next round records it
  within 15 seconds (its draft says Scheduled until then). The
  daily limit (30 tries a company) counts tries, also refused ones, each
  run of a post a platform keeps slowing down, and tries whose account or
  media then wasn't ready (it is counted first). A company past it has one
  post held back per round (back an hour later, a "waits" row in its
  activity log each time: with a round every 15 seconds, up to four a
  minute while it lasts); its other due posts wait for later rounds. Retry
  publishes the
  draft's CURRENT approved version, not the one first scheduled. A
  needs-attention post blocks a new one to the same account until it is
  marked. A post's text is not kept on the job: after an edit, the draft
  shows its new version, and what went out is on the platform (the job
  keeps the version number and the post's address). Switching an
  auto-publish rule off doesn't cancel its posts (they fail when they
  run); a rule's maker or switcher losing owner rights stops it silently
  until another owner switches it on again (the queue shows the rule as
  on). Rules match the pillar's exact name: a newer plan renaming a pillar
  leaves its rule matching nothing. Jobs, rules and the activity log are
  kept forever (no retention rule; the log is never trimmed, the pages
  show the newest 200).
  Publishing to several accounts sends them one after another, at most 50
  in one round of the queue: a longer list waits for the next round. The
  companies take turns within a round, one post each per turn, but a round
  doesn't remember the last one: across rounds, the longest waiting
  company's post goes first each time.
- Calendar (step 41): the planned day of an idea comes from "Plan the next
  2 weeks" only; moving it (or planning a draft made in the studio) isn't
  built: scheduling it picks its real time. The days are worked out in the
  browser (the page says so until it is), and an idea's time is the
  planning owner's timezone. The AI's plan quality is unmeasured (topics
  may repeat older ones beyond the two weeks it is shown); a second plan
  adds more ideas beside the first.
- Analytics (step 42): nothing has met a real platform (step 40's gaps):
  the requests follow the docs (docs/research/social-publishing-apis.md,
  section 5) and are checked with fakes. Post numbers need each platform's
  analytics permissions and their app review, and ansa asks only for what
  publishing needs (step 40): so LinkedIn gives no post number at all (its
  member analytics need r_member_postAnalytics, from the Community
  Management API on an app of its own), Facebook only reactions, comments
  and shares (views, viewers and clicks are Page insights: read_insights,
  its App Review, and the ANALYZE task on the Page), YouTube views, likes
  and comments (shares and watch time need yt-analytics.readonly and
  Google's verification of it), X all but reach. Asking for more is a
  decision for you (each permission is reviewed by the platform). Facebook
  may leave shares out of a post nobody shared (shown as none, not 0), and
  that Meta takes limit(0) on the reactions and comments edges is NOT
  CONFIRMED (a refusal shows as "refused the request"). X bills every read
  ($0.005): a post read daily for its 28 days costs about $0.14. A post is
  read about once a day (20 hours after its last try), from an hour after
  it went out until 30 days after (X's 28: its link clicks end at 30), at
  most 20 a round of core's collector, every 5 minutes (a bigger backlog
  waits for later rounds); a post an owner marked as published has
  no id on the platform, so its numbers are never read. Nothing is read
  after those days: a post never read by then (published before step 42,
  or held up by a backlog) keeps none, and the page says so. A post
  deleted on its platform is still asked each day until its days end (on
  X that may be billed: whether X bills a post it can't find is NOT
  CONFIRMED), and X's answer for one is NOT CONFIRMED either (a 404 or a
  200 naming resource-not-found: both read as not found).
  Numbers a platform corrects later are kept as they were read (snapshots
  are never changed, kept forever, no retention rule). Each platform counts
  views its own way, so totals across platforms mean little. A review is
  only as good as the numbers: few posts, a short period, numbers a
  platform doesn't give and simulated ones (development) say little, and
  the code checks that a finding's numbers are the ones sent, not that its
  reading of them is right or its recommendations sound (no eval set). It
  finds numbers written in digits of any script, not in words ("forty
  percent", 四十 or a Roman numeral pass it). It
  reads the newest 100 posts of the period; its numbers stay as they were
  when it was made, and the planner reads the newest review whatever its
  age. Each try counts against the hour's 10 reviews only once a review
  can be made.
- Inbox (step 47): calls and emails show, replies to them don't exist (as
  before); chats are answered on Telegram (step 48), Messenger (step 53)
  and the stand-ins. Calls and emails from before step 47 aren't in any
  conversation (All requests lists their tickets). A caller is matched on
  the digits as written: "+39 051..." and "0039 051..." are two customers.
  A conversation a removed teammate took over stays "taken over" until
  someone hands it back. Previews decrypt each listed conversation's newest
  message (50 a page). Conversations, contacts and messages are kept
  forever (no retention rule), like calls and emails. A typed-in ticket
  or one from a hidden number has no conversation.
- ansa for one person (steps 50 and 51): a person's channels today are
  Telegram (and the stand-ins); email forwarding makes notes but nothing
  replies by email, and calls need ansa's Vapi number with the person's
  "forward when unanswered" (step 55). Personal WhatsApp and Facebook
  profiles can't be automated (no official API; unofficial tools break
  their terms and get numbers banned); Gmail reading needs Google's
  verification and a yearly security assessment (not built). "Haven't
  answered within N minutes" is checked every 15 seconds by core's
  scheduler (the wait can run that much longer) and counts only answers
  ansa sees (in ansa, or
  in the person's own Telegram app when Telegram sends them: NOT
  CONFIRMED). Away hours are weekly only (no holidays), cross midnight as
  two times, and "I'm away" has no end time: it lasts until "I'm back".
  The summary shows the newest 8 conversations and counts the last 200
  lines; it isn't emailed. Important people are per conversation (per
  channel), not per human across channels. A business can use
  "Only when I'm away" too; its customers then wait for the team at other times.
- The restaurant assistant (step 49): reply quality is unmeasured (no eval
  set): the checks hold prices, refunds and links, not whether an answer
  is right; an amount written without a currency mark ("8.50") or in words
  isn't checked, nor is a price in another currency's symbol with the same
  number. Refund words are matched in English, Italian, Spanish, French
  and German only. Each reply is a job: a run cut off (a crash, or a
  deploy that outlasts core's 20-second stop) is tried again after its
  10-minute lease, unless it had saved its reply already: that reply then
  stays "Sending..." in the Inbox (it may or may not have gone out), never
  sent again by itself. Only chats are answered
  (Telegram, Messenger, the stand-ins): calls and emails stay as they were.
  The assistant sends what Claude wrote, checked, in Automatic
  mode: a wrong but plausible answer within the menu's prices can reach a
  customer. Claude Code (development) is slower (a program starts for each
  answer) and its consumer data terms differ from the API's: never point
  it at real customers. A restaurant's own key is used only for the
  assistant and "Post for me" (menu reading, calls, emails and the
  Co-Founder use ansa's). Alerts are a job saved with the handover (a
  restart doesn't lose one), but a send that fails is only logged (no
  retry), and a customer's display name is shown in them as the channel
  gave it.
- Orders (step 52): nothing has met a real customer: checked with a fake
  model and the stand-in chat. The AI must name dishes by label; one it
  can't place, or a "yes" with no summary seen, goes to a person (the
  holding reply), so an unusual order (half and half, extras, sizes not
  on the menu as their own dish) always reaches a person. The fixed texts
  (summary, questions, confirmation, status messages) are English only,
  whatever language the customer writes. There is no online payment, no
  minimum order, no delivery area check, no ready-time estimate and no
  stock: "Not available today" is the only limit. A change or a cancel of
  a placed order is a person's job (handover). The status messages go
  only within Telegram's 24 hours of the customer's last message; past
  that the status changes and the page says the customer wasn't told.
  "Closed now" reads the opening hours only (no holidays). Orders are kept
  forever (no retention rule), their address and notes encrypted.
- Calls answered live (step 55): only the development practice phone
  exists. No real phone line is connected (no provider chosen: Vapi,
  Twilio, Telnyx or LiveKit at launch), so nobody can call ansa's number
  yet, and the person's "forward calls I can't take" is a setting on their
  own phone that needs that number. The practice phone hears with the
  browser's speech service (Chrome: Google's, online; good in Bangla) or
  whisper.cpp on the CPU (the "small" model: good English, poor Bangla;
  about 8-10 s a turn on an M2, as the model loads every time; Homebrew's
  1.9.5 aborts in its GPU mode, so the brain passes --no-gpu), and speaks
  with the browser's own voices (no Bangla voice in Chrome on a Mac:
  Edge has one); a real line will hear and speak with its provider's
  (Google's or Azure's speech for Bangla, chosen with the provider). Each
  turn waits for the whole answer (no streaming): with Claude Code on this
  computer about 3-7 s, so a caller hears a pause; nothing interrupts ansa
  while it speaks (no barge-in). Call quality is unmeasured (no eval set):
  the AI may ask for the same detail twice, and its note may miss
  something said (the caller's words stay in the conversation). The note
  is written once the call ends (a job), so the request's summary arrives
  a few seconds later; a note that fails leaves the request as the call
  left it. Calls aren't listed on the Calls page (that is still Vapi's
  finished-call reports): they are conversations in the Inbox. ansa never
  ends a call by itself: the caller hangs up.
- The "easy to use" pass (2026-11-01): Home, Settings, Settings →
  Assistant and the conversation page were simplified by hand; nothing
  measures how easy they are (no user testing yet). "Done" on a chat's
  request closes it and hands the conversation back in two transactions:
  a refused hand back leaves the request closed and the conversation taken
  over (the page then offers "Hand back to ansa").
- "Post for me" (step 54): nothing has met Facebook (step 40's gaps):
  posts go out only once ansa's Meta app passed review (core writes each
  one up to a day before its time, and its queue sends it within about 15
  seconds of it). Posts are text only (no image service yet). The brain is
  rules and numbers, not an AI: its mix, its few special days (no
  Ramadan, Easter or national holidays, whose dates move) and its weights
  are fixed in code, and it learns only from the numbers Facebook gives
  ansa (reactions, comments, shares). Post quality is unmeasured (no eval
  set): ansa's checks stop made-up prices, offers and links, not a dull
  or odd post. The post's language follows the business's details.
  Switching it off switches off the Facebook "any pillar" rule even if an
  owner made it for other posts. Posts are plain text, like every draft,
  and the business's details go to the AI.
- Messenger (step 53): nothing has met Meta: the webhook, the Send API,
  subscribed_apps and the name lookup follow Meta's documentation (Graph
  v26.0) and are checked with fakes. Real customers' Pages need Meta's App
  Review for pages_messaging and pages_manage_metadata (and Business
  Verification); until then only Pages of people with a role on ansa's
  app work. NOT CONFIRMED: the exact shape of message_echoes (an echo of
  ansa's own reply is matched by app_id, and saved once anyway by its mid),
  whether Meta Business Suite's replies arrive as echoes, and whether the
  name lookup needs more than pages_messaging. A Page whose subscription
  Meta refused shows "Messages come to ansa" while no message comes (only
  a log line says it): connecting it again tries again. Pages connected
  before step 53 lack the permissions until connected again. Replies past
  24 hours (Meta's HUMAN_AGENT tag needs its own review) are refused; the
  status messages of orders too. One person is a different customer on
  each Page (Page-scoped ids). Attachments are only named. A Page
  connected in two companies receives nothing in either.
- WhatsApp Business (step 56): nothing has met Meta: the sign-up, the
  webhook, the Send API and the account changes follow Meta's documentation
  (Graph v26.0, Embedded Signup v4) and are checked with fakes. Real
  businesses need ansa to be a Tech Provider with App Review for
  whatsapp_business_messaging and whatsapp_business_management (and
  Business Verification); until then only numbers of people with a role on
  ansa's app work. NOT CONFIRMED: the echo's shape for a customer known only
  by a business-scoped id (ansa reads to_user_id, else to: a mismatch would
  put the business's reply in a conversation of its own), is_on_biz_app in
  the account's number list, and debug_token's granular scopes for a
  business token. Delivery and read statuses are ignored: a reply Meta
  accepted but couldn't deliver still shows as sent. Only replies within
  24 hours exist (no message templates), so neither ansa nor a person can
  write first or late from ansa; order status messages too. Voice messages,
  photos and files are only named, never downloaded or heard. WhatsApp
  calls aren't answered (Meta's calling isn't offered on a number shared
  with the app, and needs a media bridge: the phone provider at launch).
  Since 1 October 2026 Meta charges each business for replies past 1,000 a
  month per number (a payment method in WhatsApp Manager), which ansa
  doesn't show or limit yet. Disconnecting in ansa doesn't remove ansa on
  Meta's side (the business does, in the app or WhatsApp Manager); Meta
  keeps sending that number's messages, which ansa ignores. One number per
  company. The same customer is a different conversation on WhatsApp than
  on a call or Telegram (a contact per channel).
- Telegram (step 48): nothing has met a real bot or a real Telegram
  Business account: the updates and answers follow Telegram's Bot API
  documentation (version 10.3) and are checked with fakes. NOT
  CONFIRMED: whether an account without Telegram Premium can add a
  chatbot (sources disagreed; docs/going-live.md, section 12, step 1),
  whether the restaurant's own messages reach the bot (saved if they do),
  and what Telegram answers a reply past its 24 hours (ansa refuses it
  first). A bot added in Telegram before the Start waits an hour: after
  that the owner removes and adds it again, or starts a new code. An
  account an owner disconnected in ansa comes back only through a new
  code, and the chatbot must then be added again (Telegram sends no
  update for a bot that stayed). Edited messages keep their first
  version; photos, voice and files are only named (open Telegram to see
  them); the reply window counts from when ansa received the customer's
  message. The bot's notes to an owner are best effort (logged when
  Telegram refuses). One Telegram account per company. Telegram's
  webhook is limited per IP only as a ceiling: all restaurants' messages
  come from Telegram's addresses. Customers' names are stored as
  Telegram gives them. Disconnecting in ansa leaves ansa listed under the
  account's Chatbots until the owner removes it there.
- Menu (step 46): one price per dish (sizes are separate dishes:
  "Margherita, large"), no options or extras, no photos of dishes, no
  allergens field (a description or a knowledge article holds them).
  Changing the currency in What it knows doesn't convert the prices: they
  are read in the new currency as stored. "Not available today" ends at
  the restaurant's midnight, also for a place open past it. Reading
  quality is unmeasured (no eval set): the owner checks every row, and a
  dish the AI missed is added by hand. iPhone HEIC photos are refused
  (phones usually send JPEG); a PDF goes to the AI as itself, so a scanned
  one can be read too.
  Reading again adds the dishes again: nothing spots duplicates.
- Restaurant setup (step 45): hours past midnight are two days (18:00 to
  00:00, then 00:00 to 02:00 the day after), at most two times a day, and
  there are no holidays or one-off closures yet. Every company that
  existed before step 45 goes through the setup too: its owners are sent
  to /welcome from Home (a redirect made in the browser after Home's shell
  shows, as notFound() is, Cache Components). The sidebar's hours are
  worked out when a page loads, not live. Saving the setup's name,
  description or address replaces those confirmed facts without the
  Profile page's stale check (two owners at once: the later save wins).
  The old Setup page (/setup, "Phone, email and documents") stays, and its
  checklist is still the support one.
- Navigation (step 44; three sections since the "easy to use" pass): the
  sidebar links Home, Inbox and Settings only (and Orders for a business
  that takes orders). Calls and Emails are reached from the Inbox, and the
  Co-Founder's Overview, Interview, Profile, Strategy, Calendar, Queue and
  Analytics from Settings → "Older pages" (folded), until step 58 moves or
  removes them. A bookmark of the old ticket list (/dashboard?view=...)
  opens Home, which ignores the view. On a phone there is no logo or
  company name on screen (the bottom bar has only the sections).
- Business overview (step 43): a count stops at "10,000+" (the list it
  links to has the exact number). "Failed in the last 7 days" counts posts
  by their last change, also one scheduled again on its account since (as
  the queue's Failed list does), and "scheduled for the next 7 days"
  includes posts already due and waiting for the queue's next round
  (within about 15 seconds); its link opens the queue's Scheduled list,
  which also lists posts due later than 7 days. "Calls in the last 7 days"
  counts by when the call was saved, and the Calls page it links to has no
  date filter (it is newest first). The overview adds up to three queries
  to every view of Home, each count bounded. Members see the Co-Founder's
  numbers too, as they read its pages. The Overview's
  checklist counts real state of any kind: a development stand-in account
  as connected and simulated numbers as numbers (both say so), a post that
  failed as a post scheduled, and the interview is done only once it
  covered every key fact. Nothing checks how the pages look at 360 px but
  the step 43 run by hand (headless Chrome, IMPLEMENTATION_PLAN.md): the
  checks read the classes that make the rows wrap.
- Deletion (step 43): published posts stay on the platforms. Nothing in
  ansa takes a post down: a published draft can't be archived, and
  deleting media, disconnecting an account or deleting an article leaves
  what went out (the stand-in's files in .dev-social/ too); a person
  removes it on the platform. Nothing of the Co-Founder is deleted on a
  schedule (only expired connection attempts are, by core's cleanup): facts,
  interview messages until Start over, plans, drafts, media, posts, numbers,
  reviews and the activity log are kept, with no retention rule and no
  export. Removing a company or a person's data on request is done by hand
  in the database.
- The end-to-end journey check (step 43, journey-checks.ts) was deleted with
  the old backend's checks (Phase 8): core's and the brain's tests prove
  each module on its own (a fake brain, the stand-in account, simulated
  numbers), and nothing walks one company from signup to a checked review
  any more. None of them proves Anthropic's answers, a platform's API or a
  real phone call (each BLOCKED on its account, IMPLEMENTATION_PLAN.md's
  acceptance checklist).

## Before launch (not code)
- Fill in lib/site.ts: registered company name, contact email, governing law.
- Have a lawyer review app/(marketing)/privacy and terms, then set
  legalPagesReviewed: true (that removes the "draft" notice).
- Decide pricing; set it on the Stripe price and on app/(marketing)/pricing.
- Name the hosting provider in the privacy policy once chosen.
- Work through docs/going-live.md.

For the Co-Founder (docs/going-live.md, sections 5, 7, 8, 10 and 11):
- ANTHROPIC_API_KEY: without it the interview asks its fixed questions and
  proposes nothing, and no plan, draft, calendar plan or review is made.
  Decide on zero data retention with Anthropic (Known gaps: what each use sends).
- Choose an image and video service (IMPLEMENTATION_PLAN.md decision 9),
  write its provider in core (core/internal/mediagen; its name in ModeFor
  and in core's MEDIA_PROVIDER check) and set MEDIA_PROVIDER; until then
  production has uploads only.
- Get ansa's developer app on each platform and set its pair of settings:
  LinkedIn (Share on LinkedIn and Sign In with OpenID Connect; post numbers
  need the Community Management API on an app of its own), Meta (App
  Review for pages_show_list, pages_read_engagement and pages_manage_posts,
  and Business Verification), X (pay-per-use credits and a spending limit),
  Google (OAuth verification; YouTube's audit past 100 uploads a day).
- Run core on a host that keeps it running all the time (never one that
  stops it between requests), one copy with its scheduler on
  (CORE_SCHEDULER unset; "off" on any other): scheduled posts, the
  assistant's catch-up, "Post for me", post numbers, stuck image requests
  and the cleanup run inside it, and nothing outside calls them
  (docs/going-live.md, section 8).
- Agree with each customer before switching on any auto-publish rule (none
  is on, and nothing switches one on but an owner).
- Check the first real connection, post and numbers of each platform
  (docs/going-live.md, section 11) before calling it working.

For the restaurant assistant (docs/going-live.md, sections 5 and 12):
- Decide who pays for the assistant's AI: ansa's ANTHROPIC_API_KEY, or
  each restaurant's own key (Settings → Assistant). Claude Code is never
  an option in production.
- Check whether a Telegram account without Premium can add a chatbot;
  if not, the bot-per-restaurant fallback replaces step 48's connect.
- Make ansa's bot with @BotFather (Business Mode on), set its three
  settings in core, point it at core with
  `make telegram-webhook ACTION=set URL=https://<core's public address>`
  (from core/), and check one connection, message, reply and removal with
  ansa's own test company.
- For Messenger (docs/going-live.md, section 13): add the Messenger
  product to ansa's Meta app, set MESSENGER_VERIFY_TOKEN and the webhook
  (messages, message_echoes), pass App Review for pages_messaging and
  pages_manage_metadata, and check one Page's message, name, reply and
  Business Suite echo with ansa's own test Page.
- For WhatsApp (docs/going-live.md, section 14): add the WhatsApp product
  to ansa's Meta app, become a Tech Provider (Business Verification, App
  Review for whatsapp_business_messaging and whatsapp_business_management),
  make the Embedded Signup configuration (WHATSAPP_SIGNUP_CONFIG_ID), set
  WHATSAPP_VERIFY_TOKEN and the webhook (messages, smb_message_echoes,
  account_update), decide how packages explain Meta's charge for replies
  past 1,000 a month, and check one number of each kind (the WhatsApp
  Business app's and a new one) with ansa's own test business.

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
- 2026-10-16: Vapi webhooks use HMAC. Defaults: SHA256, x-signature,
  x-timestamp (a Vapi HMAC credential's own header defaults, changed from
  x-vapi-* on 2026-10-26), "{timestamp}.{body}", hex, seconds, 5 min window. Header
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
- 2026-10-17: Step 14: recordings copied into private storage from allowed hosts
  only (VAPI_RECORDING_HOSTS, default storage.vapi.ai), at most 100 MB, audio only.
  Played via /api/calls/<id>/recording (login + company check, no caching).
- 2026-10-17: Step 15: inbound email via Resend Receiving (the proposed default),
  signed with Standard Webhooks (standardwebhooks library). Email is triaged into a
  ticket; the AI sends no email replies (open decision).
- 2026-10-17: Step 16: Setup page for owners (members see it read-only): checklist,
  reply-to address, phone numbers, support addresses, link to Team for categories
  and invites, documents in private storage under documents/<companyId>/. Document
  type comes from the file extension (allowlist), never from the browser; downloads
  are always "save as" (attachment), through /api/documents/<id> (login + company
  check, no caching).
- 2026-10-17: Step 17: hosting still undecided; built for Vercel (proposed) without
  locking in: only vercel.json (daily cron) is Vercel-specific. Neon via its pooled
  URL. CI on every push (.github/workflows/checks.yml) with throwaway secrets.
  Errors logged without messages (instrumentation.ts), startup warnings for any
  dev stand-in left on in production, Resend bounce/spam events recorded on the
  sent email. Deploy steps in docs/going-live.md.
- 2026-10-17: Step 18: Stripe (the proposed default, not decided) behind
  USE_STRIPE. One plan: STRIPE_PRICE_ID, so pricing is set in Stripe. Stripe
  Checkout to subscribe, Stripe's portal to manage; webhooks always re-read the
  subscription from Stripe (handles late or out-of-order events). The company
  comes from the id we put on the checkout; billing never moves between
  companies. Dev stand-in: "simulate" buttons on /billing (refused in production).
- 2026-10-17: Step 19: public website in app/(marketing) (landing, pricing,
  privacy, terms), fully static. "/" is the landing page now (the old redirect
  to /dashboard is gone). Legal pages describe only what the code really does and
  show a draft notice until reviewed; placeholders live in lib/site.ts. Pricing
  page says the price is being finalised. robots.txt keeps the app unindexed.
  Fixed the font: globals.css pointed --font-sans at itself, so every page had
  been showing the browser's serif font.
- 2026-10-26: Step 34: company knowledge base (IMPLEMENTATION_PLAN decisions
  1-4): Postgres full-text search ('simple' configuration, GIN), no embeddings.
  Kind and status are text with CHECKs, not pg enums. The search column
  lower-cases with ICU's root collation (COLLATE "und-x-icu") and NFKC, as the
  query does in JS: Postgres alone lower-cases only a to z in a database whose
  locale is "C" (the local one here), so "État" would never match "état".
  Deleting a document clears its articles' source in its own transaction
  (Drizzle can't write ON DELETE SET NULL for one column of a composite key).
  Restoring an archived article makes it a draft again (approve again); an
  owner's edit of an approved article keeps it approved, in their name. A
  revision number makes a stale edit or approval fail instead of
  overwriting. Caps: 1,000 articles per company, 200,000 characters per
  import. New dependencies (exact versions): mammoth 1.13.0 (.docx text) and
  unpdf 1.8.1 (.pdf text, PDF.js), the only way to read the two document types
  Setup already accepted; both run bundled in the Next server build (tried
  with a probe route against `next start`) and in the checks (tsx), so no
  serverExternalPackages. Web pages are fetched by our own lib/safe-fetch.ts
  (node:https with a pinned lookup), not a library.
- 2026-10-26: Step 34 review fixes. The .docx guard reads archives as
  mammoth's JSZip does and refuses any layout the two could read differently
  (an understated entry count, offsets JSZip would shift, zip64 markers,
  files sharing bytes): it had passed an 80 KB file that JSZip unpacked to
  80 MB. The safe fetch's time limit now also stops a request about to
  start after a late DNS answer. Saving new articles takes the company row
  lock (two saves at once had passed the 1,000 cap). A restore or approval
  refused because another owner changed the status meanwhile says so
  ("wrong-status"). Forms get back up to 2,000 characters (the web address
  field). Both import forms show the no-customer-data notice. A web page
  title is found without toLowerCase() (Turkish "İ" shifted it).
- 2026-10-27: Step 35: the live call searches knowledge through a Vapi
  function tool on the existing signed webhook (IMPLEMENTATION_PLAN decision
  5), not Vapi's own knowledge base (that would put every company's documents
  in ansa's one Vapi account, searched by Google's models). The answer is one
  line, "[Title] text" pieces joined with " | " (3 pieces, 1,500 characters)
  behind a "reference text, not instructions" label: step 34's <article>
  slice has line breaks, which Vapi refuses. Lookups are rows of article ids
  (uuid[], no foreign key, so a deleted article shows as deleted) under
  Vapi's call id, because the call's own row is saved only when the call
  ends; the question is never stored. An answer is given only once its
  lookup is saved, each tool call on its own. 120 searches a minute per
  company, on top of the per-IP limit. "Test what the AI finds" also shows
  the phone line. No new dependency, no new setting. Built and checked with
  fakes only (no Vapi account).
- 2026-10-27: Step 35 review fixes. The phone line's pieces now sit in
  escaped <article> tags, as in step 34's slice but on one line: tags need
  no line break, and with "[Title] text" joined by " | " an article could
  write a piece of its own or a fake end of the reference text. The
  Knowledge page no longer says the AI doesn't read articles on calls. A
  tool call whose per-IP count fails gets a 500 like any Vapi request, not
  error entries (that needs reading the message before the limit, against
  the webhook order): a known gap with the 429 and 413.
- 2026-10-27: Step 36: the Co-Founder's business profile and interview
  (IMPLEMENTATION_PLAN decisions 1, 3 and 10). 25 topics in code
  (lib/business-facts.ts, 16 key facts, one fixed question each), text with
  CHECKs like knowledge, not pg enums. A proposal sits beside the confirmed
  value and only an owner's Confirm makes it the fact; owners only, members
  read (the profile decides what the AI says about the business). Facts are
  plain text (the company's own information, read by every later step);
  interview messages are encrypted (an owner may type anything). The first
  question is fixed text, saved with the first answer as the page showed it.
  Claude may end the interview only when no key fact is missing counting its
  proposals; without a usable answer the interview goes on with fixed
  questions, so it works without an API key. Unknown topics drop one by one
  (the rest of an answer still counts); a malformed answer drops whole.
  Settings: the interview effort low (3,000 tokens, 40 s, 1 retry: the owner
  waits on the page), suggestions effort medium (4,000, 45 s, 1 retry).
  Limits: 60 answers an hour and 20 suggestions an hour per company, 120
  profile changes per 10 minutes per person. "Suggest facts from knowledge"
  was built (not left out): any approved article an owner picks, support or
  marketing, since nothing counts until an owner confirms. The Co-Founder
  header link (after Knowledge) opens a section with its own row of links
  (AppFrame's subNavigation). No new dependency, no new setting; migration
  0030_cofounder_profile.
- 2026-10-27: Step 36 review fixes. "Suggest facts from knowledge" takes an
  approved article ticked for support or marketing (the spec's "marketing or
  support"), no longer one ticked for neither, whose page says nothing uses
  it; its menu lists every approved article (up to the 1,000-article cap; it
  had stopped at 500 by title without saying so). Prompt cuts never split an
  emoji: the API refuses half of one, and a fact holding it broke every
  interview turn and suggestion until someone edited it. Confirm and Edit
  and confirm also name the fact the page showed beside the proposal, so a
  value another owner saved meanwhile is never replaced unseen. Start over
  and the reply save take the company row lock, as the answer save did: a
  row lock on the answer only made Start over wait, and the reply saved
  meanwhile stayed behind. The pages call the interview finished only while
  no key topic is missing (a key proposal dismissed afterwards opens it
  again). No new dependency, no new setting, no migration.
- 2026-10-27: Step 37: the Co-Founder's marketing plan (IMPLEMENTATION_PLAN
  decisions 3 and 10). Versions are rows numbered under the company row
  lock (the newest + 1, as ticket numbers are taken), never deleted; the
  newest is the current plan, and a version's page has its number in the
  address, like tickets. The plan is stored as plain JSON in the shape
  Claude writes (the spec's keys) and read back with the same Zod schema;
  texts and long lists are cut rather than refused (a model can't count
  characters, and a plan takes minutes), while missing minimums refuse.
  A plan can be made once "What the business does", products or services,
  and target customers are confirmed. The support-trends setting is a
  column on companies (owners, on the Strategy page, off by default,
  settings-changes limit) and sends category names and counts of the last
  30 days only. Settings: effort high, 16,000 tokens, one try of 270 s (a
  retry after a timeout could never finish inside the page's 300 s); 10
  plans an hour per company. The Co-Founder's row of links now sits in
  <Suspense>: the version page's number would otherwise stop the build.
  No new dependency, no new setting; migration 0031_marketing_plans.
- 2026-10-27: Step 37 review fixes. The products, services and goals facts
  take turns at the article search's 20 words (combineSearchTexts): joined,
  a products list of 20 words or more left the other two out of it. "Make
  a new plan" marks the note box only for the note's own problem; any
  other message (the AI, the hourly limit) shows apart, and none while a
  new try runs. The version page has an h1 ("Marketing strategy", as on
  the Strategy page), and a check reads every signed-in page for one.
  Members are no longer told to answer the interview or fill in facts. The
  Strategy page and the Fact legend say what the AI is told, not what the
  code can't check ("check each point"). The step 37 rule now says which
  values have card-like numbers hidden (the facts and the note; articles
  and category names go as written). No new dependency, no new setting,
  no migration.
- 2026-10-27: Step 38: the Co-Founder's content studio (IMPLEMENTATION_PLAN
  decisions 7 and 8). Platform rules live in one pure file
  (lib/content-rules.ts) that the browser's live checks, the approval in
  /db and the AI's prompt all read; X is counted with twitter-text's
  weights (approximated), YouTube's description in bytes (its own limit).
  The published text is body, call to action and hashtags, each its own
  paragraph, and the limits count all of it. Every content field is text,
  empty when unused; platform and format are fixed when a draft is made.
  A blank draft is an "idea" (nothing written yet). generated_version (not
  in the spec) records the version the AI last wrote, so the page knows a
  hand edit (Regenerate asks first) and the claims list is known to be out
  of date; facts_used, knowledge_used and plan_version (also not in the
  spec) record what the AI read, so a claim is checked again against the
  facts it was written from. "I checked these claims" is also needed for a
  text written or changed by hand (no code lists its claims). The AI may
  write a draft once what a plan needs is confirmed (the same rule); a
  blank draft needs nothing. Anyone writes, edits, regenerates, archives
  and restores (none of it publishes, and an edit only ever takes an
  approval away); owners approve and reject. Every change of content is a
  new version and clears the approval in the same UPDATE; a CHECK refuses
  an approved draft whose version moved on. Images and videos can't be
  attached before step 39, so only text posts can be approved now. Rate
  limits: 30 AI texts an hour per company, 120 draft changes per 10
  minutes per person. Settings: effort medium, 12,000 tokens, 120 s, one
  retry. Found by the run against `next start`: Claude's errors were
  logged under minified class names ("m"); adapters/claude-errors.ts now
  names them by the SDK's classes. No new dependency, no new setting;
  migration 0032_content_drafts.
- 2026-10-27: Step 38 review fixes (8 findings, all real). A draft's texts
  hold at most 30 combining marks in a row (Unicode's stream-safe bound):
  normalizing a longer run takes time growing with its square, and one
  draft page view could hold the server for minutes; the rules also search
  each text once for all the words to avoid. X's count strips a link's
  closing punctuation with a loop (the regular expression was quadratic).
  New draft and the editor send their action from onSubmit: React's reset
  after <form action> put the controlled menus back to their first option,
  so a retried "Write it with the AI" made a LinkedIn draft (reproduced in
  Chrome with React 19.3). A stale Regenerate is refused before Claude is
  asked; the editor counts as unsaved only what a save would change; a
  title or call to action keeps the zero-width joiner and non-joiner and
  emoji tags; a refused approval refreshes the page. One cleaner for every
  draft text: lib/content-studio/draft-text.ts. No new dependency, setting
  or migration.
- 2026-10-27: Step 39: the Co-Founder's media library (/cofounder/media):
  media_assets and media_generation_jobs, and content_drafts.media_asset_id
  (migration 0033_media_library). Uploads are checked by name AND file
  signature, in the browser and on the server, 4 MB, private storage under
  media/<companyId>/, served inline with the stored type, nosniff and a
  sandbox. Generation goes through lib/media-generation.ts, one adapter per
  service; only the development stand-in exists (a flat-colour PNG built
  with node:zlib, no dependency; a video fails "no_video_provider"). A real
  service is OPEN, so production says image generation isn't set up
  (MEDIA_PROVIDER, the only new setting; the stand-in is refused there).
  Requests run after the answer and from the daily job, claimed in ONE
  UPDATE, 3 runs at most; a result is saved with its asset (and attached
  to its draft as the next version, the approval cleared) in one
  transaction; a failure is a code and never an asset. Where the spec left
  room: everyone in the company uses the library (as the studio); a
  draft's "Make the image with the AI" is for posts with an image only (a
  video's image description is its thumbnail); a draft that failed to
  publish keeps its media too (step 41 may retry it); deleting removes the
  row first, then the file (the draft rules decide in the row's
  transaction); a deleted generated asset leaves its job succeeded with
  asset_deleted_at; "Start now" for stuck requests; 30 requests a day and
  300 files / 500 MB per company; generated images get no alt text (a
  person writes it). lib/allowed-host-download.ts is the recording download
  made general (one time limit for the whole download: 60 s for
  recordings, which had 30 s per redirect).
- 2026-10-28: Step 39 review fixes (11 findings, all real). An image's alt
  text is published with it, so changing it is now the next version of
  every draft using it (its approval cleared; refused while one is
  scheduled, published or failed), and the words to avoid are looked for in
  it: a member could change what an approved post would publish. A change
  of media alone carries generated_version along: every post the AI wrote
  with an image looked changed by hand (the claims tick always needed,
  Regenerate asking). A request from a draft records the draft's version
  and attaches only at it (media_generation_jobs.draft_version, migration
  0034_media_request_versions with two hand-added UPDATEs): a stuck one run
  hours later replaced an image approved since. One open request per draft
  (the draft's row locked, a unique index); a new one over a stuck one ends
  it "superseded". "Start now" claims before answering: the page came back
  still stuck, never refreshed, and the editor didn't wait. Open requests
  count toward the 300-file cap, and a generated file is checked again when
  saved, under the company row lock ("library_full"): 30 requests at 299
  files made 329. Also: a failed request from a draft says why on its page;
  a result over 100 MB is "output_too_large", not a "Try again"; the upload
  form keeps its typed alt text when the file is chosen again; the preview
  marks the stand-in's images; links to an image's card name its library
  page; a JPEG's sides follow its Exif orientation. No new dependency or
  setting.
- 2026-10-28: Step 40: social account connections (IMPLEMENTATION_PLAN
  decisions 6, 7 and 8). OAuth 2.0 per platform through ansa's own
  developer app (8 new optional settings, in pairs: LINKEDIN_, FACEBOOK_APP_,
  X_ and GOOGLE_ CLIENT_ID / SECRET), PKCE where the platform documents it
  (X, YouTube), the state stored only as its SHA-256 hash and claimed in one
  UPDATE, tokens encrypted per company, connection and kind. A platform
  without its app is "stand-in" in development (connects at once, posts to
  .dev-social/) and "not set up" in production, like Billing. Decisions
  where the spec left room: refreshIfNeeded in lib/social-publishing.ts is
  the decision and the call, and services/social-tokens.ts saves its result
  (lib/ may not touch /db); a renewal the platform REFUSES marks the
  connection needs_reauth, but one it doesn't answer leaves it connected
  with the code noted (a passing 503 must not force a reconnect; the next
  use tries again); each adapter is two files (OAuth and identity, then
  publishing; Facebook a third for its Graph basics) to keep the ~200-line
  rule, still one platform's code in /adapters; LinkedIn asks openid +
  profile (who the member is, via /v2/userinfo) besides w_member_social,
  and YouTube youtube.readonly besides youtube.upload (channels.list can't
  run on upload alone); Facebook reads /me/permissions so the scopes shown
  are the ones granted, and sends appsecret_proof so "Require App Secret"
  can be on; LinkedIn's commentary is escaped for its little text format
  with hashtags as its template; a stand-in post answers url null; videos
  are published to YouTube only for now (PUBLISHED_FORMATS); removing a
  teammate disconnects the LinkedIn profiles they connected, in the
  removal's transaction (they post AS that person). The callback redirects
  with 303 and fixed result codes only. Checks never reach a platform:
  local-only.ts also refuses to run with a platform app set. No new
  dependency; migration 0035_social_connections.
- 2026-10-28: Step 40 review fixes (11 findings, all real; two were one
  defect). Google's grant (and maybe X's) is the account's with ansa's one
  app, so a Disconnect has it revoked only once no connection of that
  account anywhere still holds tokens: a yes/no read across companies
  (db/social-account-connected.ts, listed with the exceptions above),
  rather than never revoking (the spec asks for a best-effort revoke); the
  platforms that revoke are one list (REVOKES_ON_REQUEST) for the question
  and the service. Token
  renewals are claimed in one UPDATE (renewal_started_at, migration
  0036_social_renewal_claims), one run at a time, the others waiting for
  the new tokens: two runs renewing at once could send X a refresh token it
  had just taken, mark the connection needs_reauth and throw the first
  run's new tokens away (chosen over letting a late success overwrite the
  refusal, which still failed the second run's post). Tokens are decrypted
  under the stored id (an id in capitals found the row and couldn't read
  it). Facebook needs all three permissions. The Accounts page works out
  each access's lifetime as of now in the service (a refresh token past
  its own end renews nothing; "ran out on" only for a date that passed),
  and its actions reopen it without the last result in the address. The
  privacy policy no longer says who disconnected an account is kept (it
  isn't). lib/env.ts moved its social settings to lib/social-settings.ts
  (the ~200-line rule). No new dependency or setting.
- 2026-10-28: Step 41: the Co-Founder's publishing queue, calendar and
  activity log (IMPLEMENTATION_PLAN decisions 8 and 11). Permission is
  decided when a post RUNS, on one snapshot, never from how it was
  scheduled: the approved version, the approver still an owner, the
  account connected, a rule still on with its owners. A draft's status
  follows its posts only while the queue has it (scheduled / published /
  failed), so a person's later change always wins; "failed" also covers a
  post needing attention (labelled "Publishing problem"). A scheduled or
  failed draft stays editable, rejectable and archivable: each cancels its
  waiting posts (asking or warning first); a published one is final. A
  draft may go to more accounts while scheduled or published; Retry is
  checked like a new schedule and publishes the current approved version;
  a stale "publishing" claim always becomes needs_attention, even when
  nothing may have been sent (no run can know how far a dead one got).
  Auto-publish rules: created off, switched on by an owner's confirm, and
  both their maker and their switcher must stay active owners; scheduling
  without an approval needs the owner's explicit tick, and a rule's post
  needs no blocking issue and no claim an owner would check (an unbacked
  claim or a hand edit). The owner's re-checks run rules too: a word to
  avoid confirmed after an approval stops its post. Due posts are claimed
  one at a time (a scalar SKIP LOCKED subquery: the IN form claimed
  several, found by the restart check). Each claim gets its own claim_id,
  which every read and write of that run names: the attempt number alone
  repeats after a Retry (its tries start again at 1), and a run whose
  claim was handed to a person could then read and send the post again
  (found by a check written for it). A run asks the platform only while
  its claim is under 6 3/4 minutes old (10 minus the longest answer), so
  the 10-minute handover never meets a post still going out. An approval
  by someone made a member or removed since counts for nothing, and
  another owner may approve the same version again (Approve had answered
  "approved already", so the refusal's "an owner approves it again" led
  nowhere). Limits: 30
  post tries a day per company (each X post costs ansa's app), 120
  publishing changes per 10 minutes per person, 10 calendar plans an hour
  per company, 300 cron calls an hour per IP; a 429 is tried 5 times
  (retry-after within 30 s to a day, else 1, 2, 4, 8 minutes). Times are
  sent by the browser as one UTC instant (lib/publishing/schedule-time.ts,
  Intl only: no dependency). "Plan the next 2 weeks" reads the plan only
  (no facts), cadence x 2 weeks per platform, at most 40 ideas.
  adapters/claude.ts's settings moved to adapters/claude-settings.ts (the
  ~200-line rule). No new dependency or setting (CRON_SECRET is reused);
  migrations 0037_publishing_queue and 0038_publish_claim_ids.
- 2026-10-28: Step 41 review fixes (8 findings, all real). The runners let
  the companies take turns (one due post each per round, the longest
  waiting first), and a company whose post its daily limit held back gets
  no more turns in that run: one company's queue (posts past its 30 a day
  came back every hour, never failing) could take every post a run may
  start from all the others. The daily limit is counted before the
  account is made ready, so a held-back post costs no renewal or media
  read. The daily job sends due posts first: a run starts one only in its
  first ~30 s, which its cleanup or one stuck call used up, so on Hobby
  nothing was sent; a run stopping with posts due logs it. Both cron
  routes check the secret before the per-IP count (as the webhooks do), so
  a pinger's other customers on its addresses can't use the scheduler's
  calls up. Making an owner a member disconnects their LinkedIn profiles,
  as removing them does: those post as them, and a member can't cancel a
  post or disconnect. A failed post replaced on its account (scheduled
  again there since) no longer keeps a published draft "failed" (and
  editable), and offers no Retry, which could never work; an approval
  leaves a draft the queue has in the queue's status. A post cut off
  while sending is listed and counted as needing attention at once (the
  pages compute it; Next.js forbids writes while rendering), and a
  person's Mark or Retry records the handover first: on Hobby the next
  runner could be a day away. Each post's buttons name it for screen
  readers. db/content-calendar.ts now holds the calendar's planned drafts
  read (the ~200-line rule). No new dependency, setting or migration.
- 2026-10-28: Step 42: the Co-Founder's analytics and evidence-based
  recommendations (IMPLEMENTATION_PLAN decisions 6 and 10). Numbers are
  snapshots (post_metrics) that are never changed; a number a platform
  doesn't give is NULL and shows as not available, never 0. Decisions where
  the spec left room: the permissions step 40 asks for are kept, so only
  what they allow is read: LinkedIn nothing, Facebook a post's reactions,
  comments and shares with the Page token (no insights), YouTube the Data
  API's live statistics with youtube.readonly (not the Analytics API's
  48-72-hour-late views, which need yt-analytics.readonly), X its public
  and, under 29 days, non-public metrics; the research gained a section 5
  (2026-10-28) naming the exact fields, and what stays NOT CONFIRMED.
  "Older than about a day" is counted from the latest try (20 hours), so a
  failing post isn't asked every run, and the first read waits an hour
  after the post went out; a try is claimed in one UPDATE, so two runners
  read a post once (metrics_attempted_at / metrics_error on publish_jobs:
  the job's latest try). /api/cron/publish reads 10 posts a call after its
  posts (cheap: one claim when none is due), the daily job 100, last. A
  token refused while reading marks the account as publishing does. A
  simulated snapshot may hold any number the platform has, read by ansa or
  not (to see the page as it would look with the permission), never one it
  doesn't. The review is asked with the owner's timezone (weekday and
  hour), per platform and per pillar groups with totals, counts and
  per-post averages to one decimal (so a comparison needs no arithmetic of
  Claude's own, which the check would drop), at most the newest 100 posts;
  evidence names a P or G label and the number's key, and a finding's text
  may write only its cited numbers (times and quoted topics aside),
  checked by code; limits_of_this_data is a list. The newest review goes to
  the planner whatever its age, and the plan records it
  (marketing_plans.performance_review_id). Settings: effort medium, 8,000
  tokens, 120 s, one retry; 10 reviews an hour per company. No new
  dependency or setting; migration 0039_post_metrics.
- 2026-10-28: Step 42 review fixes (8 findings, all real; two were one
  defect). The marketing planner got each cited post's topic and pillar
  whole from the stored review, card numbers included, where the review's
  own request had hidden them and cut topics to 200 characters:
  past-performance.ts now sends them as that request did (the page still
  shows the company the whole topic). X's posts are read for 28 days
  (metricsReadDays, lib/metric-definitions.ts): a read in a post's 29th or
  30th day asked X for public numbers only, and that newest snapshot hid
  every link click read before, on the page and in reviews. A review's
  number check reads any script's digits after NFKC (\d is 0-9 only, so
  ۴۰٪ or ４０% passed as no number), and the prompt asks for 0-9. A post
  past its platform's read days says none were read in them (it said "Not
  read yet") and no longer shows a failed last try's "ansa tries again
  tomorrow" (lib/analytics/post-notes.ts). X's 200 naming
  resource-not-found is not_found, like its 404 (X's docs now name the
  404); such a post is still asked until its days end, like any failure
  (a post X or YouTube can't find for a while may come back). A check now
  proves publish_jobs_metrics_only_when_published, and the step 37 rules
  name <past_performance>. No new dependency, setting or migration.
- 2026-10-28: Step 43: one product (no migration, new dependency or
  setting). Decisions where the spec left room: the dashboard's
  "Business overview" is its h1 (the ticket list an h2 below it); each
  number is read with the condition of the list it links to (the ticket
  views, the call filters, the stuck emails, the queue's needs-attention,
  the Accounts page's status as of now) and as a scalar subquery reading
  at most 10,001 rows ("10,000+"), so it matches what it opens and never
  reads a company's whole history. An interview answer starts the
  Co-Founder too, beside a fact or a draft: an answer the AI couldn't read
  leaves no fact. Members see the same numbers (every page they link to
  is theirs to read); only owners are invited to start. "Posts scheduled
  for the next 7 days" includes due posts still waiting for a run, and
  "failed" counts by the post's last change, as the queue's lists do. The
  Overview's checklist counts real state of any kind, saying so: a
  stand-in account as connected, simulated numbers as numbers; the
  interview is done only once it covered every key fact, the key facts
  once all 16 are confirmed. The consistency pass's rules (loading lines,
  login addresses, not-found pages, maxDuration, times, company keys,
  cleanup, docs naming every setting, script and file) are checks rather
  than a one-time read, so a later step can't break them unseen. The
  overview's link to solved calls is the plain address
  /calls?outcome=solved: the call brain's guard flags any `outcome` set to
  "solved" in code outside decision.ts, and stays as strict.
- 2026-10-28: Step 43 review fixes (5 findings, all real; two overlapped).
  A backup is a Neon branch or a dump written OUTSIDE the repository
  (~/ansa-backups/, kept on an encrypted disk, deleted once the deploy is
  confirmed), and .gitignore ignores *.dump and *.sql.gz: the procedure
  wrote ansa.dump into the repo folder, where the `git add -A` of the push
  that deploys would commit every company's data; a check holds the docs'
  pg_dump commands to it. Rolling back the code onto the migrated database
  is safe only to a commit holding every migration it ran, or from before
  the tables they changed: 0033's, 0034's and 0036's new rules refuse
  writes of code from before them (0039's cover columns older code never
  writes). The README says which stand-ins `pnpm start` refuses (social
  accounts, images, Billing's simulate buttons; email and files stay
  stand-ins until switched on) and that development reaches an outside
  service once its setting is set (Anthropic with ANTHROPIC_API_KEY), and
  "Import a web page" always. The overview's "posts scheduled for the next
  7 days" links to the queue's Scheduled list: it counts posts already
  due, which the calendar (from today) never shows. No new dependency,
  setting or migration.
- 2026-10-31: ansa becomes an AI assistant for restaurants (owner's
  decisions after the Phase 1 audit and the Phase 2/3 plan). Business first
  (restaurants), with Telegram and Facebook Messenger; personal accounts
  later (no official API automates a personal WhatsApp or Messenger
  account). Meta Business Verification starts in parallel. Replies are
  AUTOMATIC by default, because ansa's main goal is answering when the owner
  isn't available; "Ask me first" is an option in Settings. When the
  assistant is unsure, or a customer complains or asks for a refund, ansa
  sends a short, fixed, polite holding reply ("our team will get back to
  you") and alerts the owner, so no customer waits in silence; the AI's own
  text is never sent then. Every safety check stays: prices only from the
  menu, totals worked out by ansa, the AI label on the first message. Hidden,
  not deleted: the marketing plan, the calendar and the performance review;
  kept: weekly post suggestions, owner approval, Facebook posting. Team
  routing stays, under Settings. Approved choices: Telegram as a Telegram
  Business chatbot (one ansa bot added to the restaurant's own account;
  fallback: a bot per restaurant); five sections (Home, Inbox, Orders,
  Content, Settings; activity as a feed on Home); one structured Claude
  answer per message (ansa gathers menu, hours, notes and the conversation
  first; no tool loop); orders as their own table, "Needs you" stays
  tickets; the menu as items with prices; a short setup form instead of the
  interview; alerts by email, and by Telegram when linked; no online
  payment for orders yet; packages in one settings file, limits and prices
  for the owner to decide. Rule changes approved, written into the rules
  above at the step that builds each: the assistant may read the
  restaurant's own details and the one conversation it answers (step 49);
  the AI sends replies to customers, after ansa's checks (step 49); a
  Telegram business connection (linked by a one-time code ansa issues) and
  a Facebook Page id in a message Meta signed find the company (steps 48,
  51). New steps 44 to 55 in the build order. And a working rule: nothing
  about ansa is published or uploaded anywhere (How to work with me).
- 2026-10-31: Step 44, new look and app shell. A sidebar (from 768 px) and
  a phone bar fixed to the bottom replace the header and the Co-Founder's
  row of links: Home (/dashboard), Inbox (/inbox, the ticket list moved
  from the dashboard), Content (/cofounder/studio), Settings (/settings, a
  new list of the setup pages, with Log out for phones and "Older pages"
  for the Co-Founder pages the sidebar no longer links). Layouts keep
  naming their section, so the links stay static; only app/cofounder,
  whose pages are Content or Settings, marks its link from the address
  inside <Suspense>. Colours: one green accent and greys tinted toward it,
  white cards on a slightly tinted page, light only; Geist stays. New
  shared parts only where this step uses them: the sidebar and phone bar,
  a loading skeleton (PageLoading) and an empty state; a status chip,
  switch, tabs, dialog and toast come with the steps that need them
  (Base UI already has the last four). No new dependency, setting or
  migration.
- 2026-11-01: Step 47, the Inbox. Decisions where the plan left room:
  "Needs you" is derived (a conversation with an open ticket) rather than
  stored on the conversation, so it can never disagree with the tickets;
  one conversation per contact, and a contact per channel; an unverified
  email sender gets a conversation of its own; a person's reply takes the
  conversation over; the request's actions (assign, solve, close without
  emailing, notes) are the ticket page's own components on the
  conversation's page, the rest one click away; the old ticket list moved
  to All requests (/inbox/requests); assistant_activity also records a
  person's take over and hand back (the actor), and Home lists only ansa's
  own lines. No new dependency or setting; migration 0042_inbox_conversations
  (its unique (company_id, id) on inbound_emails moved before the foreign
  key that needs it, by hand).
- 2026-11-01: Step 46, the menu. Decisions where the plan left room:
  anyone in the company may mark a dish "Not available today", and it
  lasts until the restaurant's own midnight (unavailable_until, not a
  switch someone must remember to turn back); prices are stored in the
  currency's smallest unit (price_cents) and typed as text, read in the
  restaurant's currency; "Looks right" adds the checked dishes and never
  deletes or replaces existing ones; the checked list lives in the
  browser until then (nothing is stored before it), and is checked again
  on the server; a development stand-in reads a sample menu without an
  API key, so the flow can be tried for free; photos go to Claude as
  images (the first use that sends one), PDFs and Word files as their
  text. No new dependency or setting; migration 0041_catalog_items.
- 2026-11-01: Step 45, restaurant setup. Decisions where the plan left room:
  setup_progress (not in the plan) records how many steps were saved, so
  setup resumes where it stopped without guessing from the data; the
  address is the "location" business fact and the phone a settings column;
  the business types are restaurant, café, bakery, takeaway, food truck,
  bar, catering and other; two times a day, a closing 00:00 is midnight;
  the time zone and currency menus list what the server knows; existing
  companies go through the setup like new ones (owners are sent from Home);
  every setup write takes the company row lock before the person's (the
  order every other company-row writer uses). Signup no longer asks for a
  company name; the checks name their companies as setup's first step
  would, and cleanup also finds test companies by their owners' test
  addresses. No new dependency or setting; migration 0040_restaurant_setup.
- 2026-11-01: Step 44 redone as "Dining room", the owner's choice after a
  design research round (the report and the three directions are the
  owner's local file ~/Documents/business/ansa-design-rd.html, not in the
  repo). The palette is named by job in app/globals.css: a forest-green
  frame (#0B3529) holding a white sheet, bottle green (#0E4A38) for
  actions, champagne brass (#D9BE8A) only as a detail on green (1.8:1 on
  white: never text or a focus ring there), ivory for text on green; the
  meaning colours (attention, info, success, destructive) always come with
  words (components/status-dot.tsx). Every text colour was measured on its
  surfaces (4.5:1; the brief's #77857D was 3.5:1 and became #637269).
  Dark mode is designed, not inverted: deep forest surfaces, ivory text,
  brass focus rings, never black; it follows the device
  (prefers-color-scheme, and Tailwind's dark: on the same query). Type:
  Instrument Sans at 500 and 600 for the interface, Fraunces (font-display)
  only for the big moments, both through next/font (lib/fonts.ts:
  downloaded at build time and served by ansa, so no page asks Google);
  Geist is gone, code uses the system monospace. The signature is Home's
  briefing card, set like a printed menu; empty states are words only;
  badges are quiet tints; the bell is the mark and the app icon. The
  conversation screen, orders, the menu page and the website are styled by
  steps 47, 50, 46 and 55 with these parts. No new dependency, setting or
  migration.
- 2026-11-01: The website's home page, built ahead of step 55 at the
  owner's request ("The pass", chosen after the landing page research,
  ~/Documents/business/ansa-landing-rd.html, not in the repo). The hero
  is an example Telegram conversation, labelled "Example", that prints an
  order ticket (components/order-ticket.tsx) hanging over the hero's edge
  into the next section; then How it works, one example evening, what ansa
  won't do on its own, questions, and one last button. The sections live
  in app/(marketing)/_landing/; the header sits inside the hero, so the
  pricing and legal pages render their own. Still fully static, with no
  images, tracking, testimonials, customer logos or numbers that aren't
  real. Every sentence about something not built yet (Telegram and
  Messenger replies, orders with totals worked out by ansa, the AI label,
  holding replies with alerts, "no card needed") carries a "LAUNCH
  CHECK (step 55)" comment, and step 55 checks each one before the site
  goes public. The only motion is the conversation arriving and the
  ticket printing once, on load, and only without prefers-reduced-motion.
  The ticket and ansa's chat bubbles keep fixed light colours in dark
  mode, because the hero is forest green in both modes. No new dependency,
  setting or migration.
- 2026-11-01: Step 48, Telegram. Decisions where the plan left room: the
  code goes from ansa to Telegram (the owner's Start), never the other way,
  so a leaked code can at worst tie the leaker's own Telegram account to
  the owner's company, never take over a restaurant's chats; a chatbot
  added before the Start waits an hour in a table that belongs to no
  company (telegram_pending_connections, Telegram's ids only); one
  Telegram account per company, tied to one company at a time; an
  account removed in Telegram and added back reconnects by itself, but
  one an owner disconnected in ansa needs a new code; replies past
  Telegram's 24 hours, without the reply permission or without a
  connection are refused before anything is saved; messages the
  restaurant writes in its own Telegram app are part of the conversation
  (author "business_account"); messages deleted in Telegram are deleted
  in ansa; only text and captions are kept. `pnpm telegram:poll` lets a
  real bot be tried on the laptop without a tunnel. The plan's one door
  for chat and its stand-in are step 47's lib/chat-delivery.ts and
  adapters/dev-chat-outbox.ts (no new files under the plan's names). Three
  new settings (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME,
  TELEGRAM_WEBHOOK_SECRET); no new dependency; migration
  0043_telegram_channel.
- 2026-11-01: Step 49, the assistant replies on its own. The owner asked
  for two AI options in Settings: a Claude API key, or Claude Code (what
  the owner uses today). Anthropic's Agent SDK docs say a product may not
  run on a claude.ai login, so "Claude Code on this computer" is
  development only (refused in production), and "Claude API key" takes the
  restaurant's own key (encrypted) or else ansa's. Decisions where the plan
  left room: holding replies go out at once in both modes (only the AI's
  own replies wait in "Ask me first"); a handover opens a request in the
  conversation (tickets.channel "chat"), so "Needs you" stays tickets plus
  waiting replies; one holding reply until a person answers (the open
  request keeps the assistant quiet); an order request hands over until
  step 50; a reply that fails to send opens a request too; the price check
  reads amounts written with a currency mark; "Edit" is a person's reply
  that replaces the waiting one; the Telegram webhook's maxDuration is
  now 300. Also: alerts by Telegram go to the restaurant's own account
  through ansa's bot. No new dependency; one new setting
  (CLAUDE_CODE_PATH, development only); migration 0044_assistant_replies
  (its ticket_channel value written as ADD VALUE IF NOT EXISTS by hand).
- 2026-11-01: Steps 50 and 51, by the owner's direction ("ansa is my
  shadow when I'm not available", for a person or a company), chosen over
  building orders first. The build order gained "ansa for one person" (50)
  and "Only when I'm away" (51); the old 50 to 55 became 52 to 57 (code
  comments and LAUNCH CHECK markers renumbered; log entries keep theirs).
  Decisions where the direction left room: one account is a business or a
  person (companies.kind), chosen at setup's first step and changeable in
  Settings; a person's assistant says "I'm <name>'s AI assistant" and
  never pretends to be them (honesty, the EU AI Act, the platforms'
  rules); it never commits them to anything (meetings, money, decisions):
  those become notes; "away" is "I'm away", weekly away hours, or no
  answer within the minutes chosen, and a business keeps answering always
  by default; the wait is a column the scheduled runs claim (no queue
  service); important people always go to the person without asking the
  AI; "While you were away" is per person since their last "Got it".
  Personal WhatsApp stays impossible (no allowed API). No new dependency or
  setting; migration 0045_personal_and_away.
- 2026-11-01: The website's home page rewritten around the owner's core
  ("it looks like it's only for restaurants"): ansa is your AI stand-in
  when you can't answer, for one person or a whole business. Headline
  "Never miss a message again."; the hero's example is a late-night chat
  answered as "Rafa's AI assistant" and the signature is now the "While
  you were away" note (app/(marketing)/_landing/away-card.tsx) hanging over
  the hero's edge; new sections "One assistant, two ways to use it" (For
  you / For your business), "If people wait for your answer, ansa is for
  you" (freelancers, agents, clinics, salons, shops, restaurants,
  creators), "Where it answers" (each channel's real status, and that a
  personal WhatsApp number or Facebook profile can't be connected), and
  questions for both audiences. The header and the final button say "Get
  started"; the footer "Your AI stand-in when you can't answer."; signup
  says "for you or your business". Still no testimonials, logos or
  numbers that aren't real; every not-yet-built claim keeps its "LAUNCH
  CHECK (step 57)" comment. components/order-ticket.tsx stays for the
  Orders pages (step 52).
- 2026-11-01: The "easy to use" pass (the owner: "really easy to use,
  everyone loves working easy"). Three sections (Home, Inbox, Settings;
  the marketing studio became Settings → "Social media posts" for
  businesses, its pages marked Settings, no client-side folder marker
  any more). Home starts with what ansa is doing right now and the one
  button that changes it (Pause ansa / Turn ansa on / I'm away / I'm
  back, a new "Pause" path: saveAssistantStatus), then "Getting started"
  (owners, until Telegram, an AI and a menu or a person's instructions
  are there), "Needs you" by name, "What ansa did", and a business's
  numbers last; the support-era setup reminder left Home. Settings lists
  by kind, the older marketing pages folded away. Settings → Assistant
  starts with "Try your assistant", shows the away times only in "Only
  when I'm away", folds the AI engine away once it works, and the hours
  form has one "every day from ... to ..." row filling every day (the
  days themselves under "Set each day on its own"). A chat's request on
  the conversation page has one button, Done (closes it without an email
  and hands the conversation back to ansa), the rest under More; the
  Inbox says "New request" and hides it for a person; activity lines say
  "Told them you'll get back to them". No new dependency or setting, no
  migration.
- 2026-11-01: Step 52, orders. Decisions where the plan left room: the AI
  names dishes only by today's menu labels and ansa writes every summary,
  question and confirmation itself (the AI's reply text is never sent on
  an order answer); the proposal is a row ("proposed", unnumbered, one
  per conversation) saved with its summary, and a yes places it only when
  that summary reached the customer; numbers come under the company row
  lock, like tickets; a dish name and price are copied onto the order; a
  delivery fee joined the ordering settings; closed now = ansa's own "we
  can't take orders right now"; a placed order's change or cancel goes to
  a person (order_change); everyone in the company works orders; status
  messages are a person's messages that don't take the conversation over,
  sent only within Telegram's window; Orders shows in the sidebar only
  for a business that takes orders (read in <Suspense>). No new
  dependency or setting; migration 0046_orders.
- 2026-11-01: Step 53, Facebook Messenger. Decisions where the plan left
  room: the Page connection of step 40 is the Messenger connection too (one
  login for posts and messages; the messaging permissions are asked for
  beside the posting ones, and posting doesn't need them); the company
  comes only from the Page id Meta signed, and only when exactly one
  company has that Page connected; a customer's contact names the Page and
  their Page-scoped id; the Page's token is read by one service before
  sending (services/chat-send.ts), so lib/chat-delivery.ts stays the only
  door; long replies go as parts of 2,000 characters; echoes from other
  apps are the Page's own messages; the name is read once, after the
  answer. One new setting (MESSENGER_VERIFY_TOKEN); no new dependency or
  migration.
- 2026-11-01: Step 54, "Post for me" (the owner: "ansa will automatically
  create everything... it will post for the growth of the business, every
  day or every week as he wants, no prompt needed"). Decisions where the
  direction left room: ansa picks every topic with a rule-based brain that
  learns from each post's reactions, comments and shares (the AI only
  writes); it posts through the existing queue under the owner's own
  Facebook rule, switched on by the owner's one confirmed switch (so step
  41's run-time checks, retries, cancel and activity log apply), with "Ask
  me first" as an option; the AI writes from the business's own details
  only and ansa's checks stop made-up prices, percentages, offers and
  links (two tries, then the post is skipped and the page says why);
  setup's business types now cover every kind of business. No new
  dependency or setting; migration 0047_post_for_me.
- 2026-11-01: One Connections page (Settings → Connections, still at
  /settings/channels): Telegram, Facebook Messenger, email forwarding (the
  address, the last email), phone lines (read-only) and, for businesses,
  LinkedIn, X and YouTube for posts, each with its one button (the same
  connect actions as before). The Co-Founder's Accounts page stays for the
  details. No new dependency, setting or migration.
- 2026-11-01: The backend rewrite (the owner's approval, with all
  permission: a system for 5 to 10 years). ansa's backend becomes a Go
  "core" (webhooks, channels, orders, posting, logins, billing, jobs, every
  security rule, and the only database access) and a Python "brain" (the AI
  thinking only: prompts and model calls, no database, no state); Next.js
  keeps only the screens. Kept on purpose, so every company, login and
  message carries over: the same Postgres tables (the Drizzle schema and its
  migrations stay the source), the same `v1:` encryption, Better Auth's
  formats (passwords, cookie, links) and the same rate limit keys. Built
  module by module on the branch rewrite/go-python (never pushed), each
  module's rules proved again by core's or the brain's tests on a test
  database of their own (ansa_test), and documented in docs/backend/ (one
  page per module; migration-plan.md has the status). Core runs its
  periodic work itself (the assistant's catch-up and the publishing queue
  every 15 seconds, cleanup every hour), so no outside cron is needed, and
  work after a webhook is a job in a Postgres queue with leases and retries
  (migration 0048_core_jobs). The owner chose to move the hidden Co-Founder
  pages and LinkedIn, X and YouTube to core too, not to remove them.
- 2026-11-02: Phase 8 on the laptop: core is the only backend. The screens'
  switch between the two backends is gone; services/, adapters/, db's query
  files, Better Auth, the old webhook, cron and health routes, the old
  scripts and the old checks are deleted; the screens ask core who is logged
  in (GET /api/v1/me), and their settings are CORE_API_URL,
  SCREENS_SHARED_SECRET and APP_URL; the operator's scripts are core's make
  targets; lint refuses database code in the screens; CI has one job per
  part (screens, core, brain, audit). The rules above keep the old file
  names as where each rule was first written (Architecture rules says how to
  read them). Deploying (hosting for core and the brain) is open.
- 2026-11-03: The owner's direction for every outside service still to
  come: development runs on the laptop for free (a local stand-in, no
  account, no credit card), and the paid provider is chosen only for
  production, plugged in behind one door in core so nothing else changes.
  Calls (step 55) first: on the laptop a practice phone, in production the
  best of Vapi, Twilio, Telnyx or LiveKit, chosen then. WhatsApp Business
  became step 56 (personal WhatsApp stays impossible: no allowed API).
- 2026-11-03: Step 55, calls answered live. Decisions where the plan left
  room: a call is the caller's conversation (their words and ansa's as its
  messages), answered turn by turn by the SAME assistant as chats rather
  than a second brain, so calls get the same checks, orders, handovers and
  "While you were away"; one door for every phone line (start, turn, end),
  with the practice phone as the development line and the production
  provider still to choose; calls reach ansa only when the person couldn't
  answer, so they're answered whatever the away settings say and never wait
  as drafts; when ansa may not answer it takes messages (no AI) and opens
  one request when the call ends; the caller hears ansa through the
  browser's speech in development and whisper.cpp hears them (one free
  install, offline). Migration 0049_phone_calls (the table and the
  call_message reason); no new package; WHISPER_MODEL_PATH and
  WHISPER_CLI_PATH are development settings of the brain. Also: the
  database's catalog is checked again against core's tenant table list
  (away_summary_reads and user_categories were missing from it).
- 2026-11-03: Calls made smart, and Bangla (the owner tried the practice
  phone: "the AI is not smart", "it doesn't understand Bangla"; the owner
  asked for the best solution, Claude, Google, ChatGPT or our own). Claude
  stays the brain (with core's checks in the loop: a speech-to-speech AI
  would talk past them, and a model of our own can't match it); every turn
  of a call goes to the AI, which asks follow-up questions, takes a full
  message, keeps talking after a handover (one request per call) and
  speaks the caller's language; while paused, taken over or for an
  important caller it only takes a message (no answers for them, no
  order); after the call it writes a note for the person, added to the
  request (and its subject, for a request opened during that call), or a
  request of its own when someone has to act. Hearing Bangla: Google's
  speech (in Chrome for the practice phone, free; the phone provider's
  Google or Azure speech in production), Whisper kept as the private
  choice. No migration, no new package or setting.
- 2026-11-03: Step 56, WhatsApp Business (the owner's yes to the plan).
  Decisions where the plan left room: Meta's official Cloud API only,
  connected with Meta's Embedded Signup with coexistence allowed, so a
  business (or one person using the WhatsApp Business app) keeps the app on
  its phone and ansa sees its replies there; every value the sign-up
  window reports is checked with Meta server to server before anything is
  saved (whether the app shares the number comes from Meta, never the
  browser); customers are keyed by Meta's business-scoped user id (phone
  numbers may be hidden since 2026), else their number; no history or
  contact import (privacy); the token is read only by core/internal/social,
  like every third-party token; one number per company; delivery statuses,
  message templates and WhatsApp calls are left for later (Known gaps).
  Migration 0050_whatsapp_numbers (the table, and "whatsapp" as a contact
  channel); two new settings (WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_SIGNUP_CONFIG_ID); no new package. Meta's JavaScript SDK
  (connect.facebook.net) loads only on Settings → Connections, when an
  owner presses Connect WhatsApp.

