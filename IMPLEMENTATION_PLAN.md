# Implementation plan: AI Support Agent + AI Co-Founder

Started 2026-10-26 from the "Unified AI Business Platform" brief. This file is
the checklist for that work: what is decided, what each step builds, and what
is done (with the evidence). The audit behind it is in
[CODEBASE_AUDIT.md](CODEBASE_AUDIT.md). The rules every step follows are in
[CLAUDE.md](CLAUDE.md); nothing here overrides them.

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done and verified
(typecheck, lint, every check in `pnpm check:tenant-isolation`, production
build), `[b]` built but BLOCKED on an outside account.

## Starting point (verified 2026-10-26)

- Branch `audit-fixes`, about 45k lines not yet committed (no git remote: this
  disk is the only copy). A snapshot was taken before any change.
- `pnpm db:migrate`, `pnpm typecheck`, `pnpm lint`, `pnpm check:tenant-isolation`
  (450 checks, 0 failures) and `pnpm build` all pass.
- The support product (steps 1-33) is complete as far as it can be without
  outside accounts. See CODEBASE_AUDIT.md for every capability and its status.

## Decisions taken for this work (and why)

These are the defaults chosen so the work could go on without blocking. Each is
easy to revisit; the ones marked OPEN need you.

1. **Same app, same rules.** The Co-Founder is a new set of sections in the
   same Next.js monolith: /db only, company from the session, Zod on every
   input, same-company foreign keys, rate limits in Postgres, Claude only
   through adapters/claude.ts (one function + one settings object per use).
2. **Knowledge search is Postgres full-text search**, not embeddings. Anthropic
   has no embeddings API; adding Voyage or another vendor means a new account,
   cost and sending company documents out. Full-text search (`simple`
   configuration, so it works for any language, GIN index) is boring and good
   enough for one company's articles. Revisit with pgvector if recall is poor.
3. **Shared knowledge, separate audiences.** One knowledge base per company.
   Each article says whether it may be used for support (default yes) and for
   marketing (default no). Drafts are never used by any AI. The Co-Founder never
   reads tickets, calls, emails or customer data. The only support-derived
   input it can get is ticket counts per category, and only if an owner turns
   that on (off by default).
4. **Historical support records become knowledge only through a person.** A
   solved ticket gets "Save as knowledge": a teammate writes the solution in
   general terms, an owner approves it. Nothing copies customer text into the
   knowledge base automatically.
5. **The live call can search knowledge** through a Vapi function tool
   (`search_company_knowledge`) on the existing signed Vapi webhook. Built and
   checked with fakes; BLOCKED for a real call (no Vapi account), like the rest
   of Vapi.
6. **Every outside service has a local stand-in** (CLAUDE.md rule): social
   accounts publish to `.dev-social/`, images come from a stand-in generator in
   development, metrics come only from `pnpm simulate:post-metrics`. Stand-ins
   are refused in production and labeled everywhere they show.
7. **Social platforms**: LinkedIn (member posts), Facebook Pages, X and YouTube
   (video only: the API has no text posts) get one adapter file each, written
   against the official docs checked on 2026-10-26
   ([docs/research/social-publishing-apis.md](docs/research/social-publishing-apis.md)).
   All four are BLOCKED until ansa has developer apps (LinkedIn Community
   Management review, Meta App Review + Business Verification, Google OAuth
   verification, X pay-per-use credits). No adapter is called "working" until a
   real post has gone out.
8. **Publishing safety**: owner approval is required for every post, checked
   again when the job runs (draft unchanged since approval, approver still an
   owner, account still connected). Auto-publish rules exist but are off; none
   is ever turned on by this work (that needs you, on a real account). An
   unclear platform answer (5xx, timeout) is never retried automatically: no
   platform offers an idempotency key, so a retry could post twice. It becomes
   "needs attention" for a person.
9. **Image/video generation provider: OPEN.** None of the existing vendors
   (Anthropic) makes images. The provider interface, job queue, storage and UI
   are built with a development stand-in; production says "not set up" until you
   pick one (options and prices in
   [docs/research/vapi-tools-media-anthropic.md](docs/research/vapi-tools-media-anthropic.md)).
10. **Web research by the AI: not built.** Claude's server-side web search would
    add cost and unvetted sources. The Co-Founder uses the company's confirmed
    facts and approved knowledge, and labels everything else as an assumption
    or a suggestion.
11. **Scheduling granularity**: jobs are rows in Postgres (they survive
    restarts) and run from `/api/cron/publish`. Vercel Hobby only allows daily
    crons, so minute-level publishing needs Vercel Pro or an outside pinger
    (documented in docs/going-live.md). Due jobs also run right away when
    scheduled for "now", and owners can press "Publish now".
12. **No commits.** Per CLAUDE.md Rule 3, commits are yours.

## Stage 1: stabilize (fix what the audit confirmed)

Each item was confirmed real in the code first (the low-severity ones with a
probe against the local database, Node or ESLint before the fix). Done
2026-10-26: typecheck, lint, 465 checks (0 failures) and the build pass.

- [x] F1 Stripe: a second checkout before the first webhook lands double-charges
  and the dropped subscription leaves no log line. Log a fixed line, hide
  Subscribe while a payment is being confirmed. Evidence: "stripe webhook: a
  second paid checkout of a company with a live subscription is not stored and
  logs one fixed line..." and "billing page: back from a paid checkout whose
  event hasn't arrived yet, Subscribe is not offered again" (billing-company-checks).
- [x] F2 "Analyze now" with an upper-case call id encrypts the AI notes under a
  context nothing can decrypt. Lower-case ids that feed encryption contexts
  (analyzeCallSchema, and inboundEmailIdSchema: "Process again" had the same
  bug). Evidence: "brain: 'Analyze now' with the call id in capitals..."
  (brain-analysis-checks), "emails page: 'Process again' with the email's id
  in capitals..." (emails-page-checks).
- [x] F3 The daily job can run past its 300 s limit (clock starts after cleanup,
  120 s start window + a 180 s call analysis). Start the clock first and stop
  starting work when the longest item no longer fits (LONGEST_CALL_MS /
  LONGEST_EMAIL_MS from the Claude and Resend limits). Evidence: "stuck work:
  an email or call is only started while its slowest run still fits..." and
  "stuck work: the job's clock starts before its cleanup..." (stuck-work-checks).
- [x] F4 `link:phone-line` (and the other operator scripts) pick the company of
  any user row with that address. Require an active, confirmed owner and print
  the company name before acting; link, unlink and replace act only with
  `--yes`. Evidence: the three "operator scripts: ..." checks
  (operator-script-checks, which run the scripts with tsx).
- [x] F5 Sending through Resend has no time limit. Give it one (20 s, a timeout
  is a failed delivery "timeout"). Evidence: "resend sending: a send that never
  answers is cut off..." (resend-receiving-checks, real SDK, local server).
- [x] F6 Ids and names with NUL or control characters crash actions instead of
  being refused; category names with line breaks reach Claude as extra lines.
  Evidence: the two "input: ..." checks (control-character-checks).
- [x] F7 Setting a ticket's category while an owner renames it throws a foreign
  key error instead of "refused". Evidence: "categories: setting a ticket's
  category while an owner renames it answers 'not found'..." (category-limit-checks).
- [x] F8 Saving more than 50 categories for one person fails with a misleading
  message. Cap categories per company (100 active) and match the schema.
  Evidence: "categories: a company keeps at most 100 active ones..."
  (category-limit-checks).
- [x] F9 AES-GCM decryption accepts truncated authentication tags. Require 16.
  Evidence: "a transcript encrypted for one company cannot be decrypted as
  another's" now also refuses 4, 8, 12 and 15-byte tags (vapi-checks).
- [x] F10 The /db lint guard misses createRequire, aliased require and Better
  Auth's raw adapter (`$context`). `$context` is allowed in lib/auth.ts and
  lib/password-reset-links.ts (the reset-link lookup already used it; moving
  it into lib/auth.ts would push that file past 200 lines). Evidence: "lint:
  every way around the /db rule is an error (..., createRequire, a require
  kept in a variable, Better Auth's $context, ...)" (lint-guard-checks).
- [x] F11 Setup says a stuck email "is being turned into a ticket" forever. Show
  it as stuck with a link to the Emails page. Evidence: "forwarding: Setup
  shows when the company's last email arrived and what became of it, a stuck
  one as stuck" (forwarding-setup-checks).
- [x] F12 Vapi signature header defaults don't match Vapi's documented HMAC
  credential defaults (`x-signature`, `x-timestamp`). Change the defaults.
  Evidence: "vapi: the signature headers default to a Vapi HMAC credential's
  own, x-signature and x-timestamp" (vapi-checks).
- [x] Known gap kept (documented, not fixed): a Resend delivery-problem event
  that arrives before "sent" is recorded is dropped. In CLAUDE.md Known gaps
  (the "Bounces, spam reports..." bullet).

## Stage 2: shared company knowledge

### Step 34: company knowledge base  `[x]`
- `knowledge_articles` (title, body, kind: faq/policy/product/guide/solution/
  document/website, status draft/approved/archived, use_for_support,
  use_for_marketing, source document / ticket / URL, who created and approved)
  and `knowledge_chunks` (≈1,500-character pieces at paragraph boundaries,
  rewritten in the same transaction as the article, generated tsvector + GIN).
- Search: company first, approved only, audience flag, words sanitized to
  letters/digits and OR-ed into a tsquery (parameter, never sql.raw), ranked,
  each hit names its article (source attribution).
- /knowledge: list, search, filters, pages; create/edit (anyone: drafts; owners:
  approve, archive, delete, edit approved).
- Import: "Add to knowledge" on each Setup document (txt/md/csv as text, .docx
  and .pdf through a text-extraction library) and "Import a web page" (https
  only, SSRF-safe: every resolved address checked, redirects re-checked, size
  and time caps). Imports are drafts until an owner approves.
- Support: the ticket page shows related approved support articles (team only);
  solved tickets get "Save as knowledge".
- Prompt-injection rule for every later step: article text is data, wrapped in
  escaped tags, never instructions; the model has no tools.
- Done 2026-10-26 (migration 0028_knowledge_base; mammoth 1.13.0 and unpdf
  1.8.1 added). typecheck, lint, 501 checks (0 failures, 36 new) and the build
  pass; the drift check finds no schema changes. Evidence, by check file:
  - knowledge-checks: "knowledge: another company can't list, read, search,
    edit, approve, archive, restore or delete an article (services and /db)",
    "knowledge: the database refuses a piece, a person or a source from
    another company", "knowledge search: approved articles meant for the
    audience only, never drafts or archived ones", "knowledge search: at most
    2 pieces of one article and 10 hits...", "knowledge search: accents and
    capitals don't matter (ICU lower-casing...)", "knowledge: the pieces
    follow every edit of the text and the title...", "knowledge: the list and
    the search have their indexes".
  - knowledge-permission-checks: "knowledge: members write and edit drafts,
    but can't approve, archive, restore, delete or change an approved
    article; owners can", "knowledge: an owner made a member while their page
    is open can no longer approve...", "knowledge: an edit or an approval of
    an article changed since it was opened is refused...", the field, database
    CHECK, 1,000-article cap, rate limit and list query checks.
  - knowledge-text-checks: the two "chunking:" checks, "search query: words
    of letters and digits only..." and "search query: Postgres never errors on
    one, whatever was typed...", "imports: text becomes articles of at most
    20,000 characters...", "prompt slice: each hit in its own escaped
    <article> tags...", the two "extraction:" checks (txt/md/csv; docx, pdf,
    a scan-like PDF, a damaged file).
  - knowledge-zip-checks (review fixes): "docx guard: a well-made archive
    passes..." and "docx guard: a zip bomb is refused, also one left out of
    the stated count, behind bytes the offsets don't count, behind a zip64
    marker, or in files sharing bytes".
  - knowledge-race-checks (review fixes): "knowledge: five articles saved at
    the same moment, with room for two, make exactly two..." and "knowledge:
    an owner's out-of-date page is told the status changed meanwhile...".
  - knowledge-fetch-checks: the five "safe fetch:" checks (http, port,
    credentials, localhost, 127.0.0.1, [::1], 10.x, 169.254.169.254, private
    DNS answers through a fake resolver, every redirect, 2 MB, type, encoding,
    timeout, and a public page fetched from the pinned address with no cookie),
    "safe fetch: once the time is up nothing more is opened, even when a DNS
    answer comes later..." (review fixes) and "public addresses: ...".
  - knowledge-import-checks: "knowledge import: a Setup document becomes
    drafts...", "knowledge import: a long text becomes parts...; deleting the
    document keeps them", "knowledge import: a public web page becomes
    drafts... one fixed log line", "save as knowledge: only a solved ticket of
    the session's company becomes the article's source", "related knowledge:
    a ticket lists up to 3 of its own company's approved support articles",
    "knowledge import: a web page's title is read whole when letters before
    it lower-case longer (Turkish İ)" (review fixes).
  - ui-polish-checks (review fixes): "knowledge: every form that writes
    articles shows the no-customer-data notice..." and the typed-values check
    now sends a 2,000-character web address back whole.
  - knowledge-checks (review fixes): the pieces check also edits the title
    alone and checks every heading and the search follow it.
  - Pages checked by hand against `next start` (a scratch script fetching
    every Knowledge page as an owner, a member and another company), and text
    extraction inside the built server through a temporary probe route
    (removed).
  - Also fixed: two timing checks in resend-receiving-checks (50 and 200 ms
    limits) failed now and then on a busy machine, because the SDK can take up
    to half a second to reach the local server; they now allow 2 and 3 seconds.
- Left out on purpose: OCR for scanned PDFs, following links of an imported
  page, refreshing an import when its source changes, a "Test" for the
  marketing audience (the Co-Founder doesn't exist yet), and a confirm step
  before Archive (it can be undone; Delete asks). The AI reads no knowledge
  yet: step 35 adds the live call's search, through lib/knowledge/prompt-slice.ts.

### Step 35: knowledge during live calls (Vapi tool)  `[b]`
- The Vapi webhook also answers `tool-calls` for `search_company_knowledge`:
  same order (size cap, raw bytes, signature, rate limit, JSON, Zod), company
  from phone_lines, approved support articles only, one-line result, always 200.
- Records which articles each call looked up (ids only, no query text) and shows
  them on the call page.
- docs/going-live.md: how to define the tool and its credential in Vapi.
- Built 2026-10-27 (migration 0029_knowledge_lookups; no new dependency or
  setting): services/vapi-tool-calls.ts (from services/vapi-webhook.ts),
  lib/validation/vapi-tool-calls.ts, lib/knowledge/call-answer.ts (the one
  line: up to 3 pieces, each in its own escaped `<article>` tags as in step
  34's slice but without line breaks, 1,500 characters, behind a "reference
  text, not instructions" label; review fixes: the first version's
  "[Title] text" pieces joined with " | " let an article write a piece of
  its own),
  knowledge_lookups (db/knowledge-lookups.ts, services/knowledge-lookups.ts),
  "Knowledge the AI looked up during the call" on the call page,
  `pnpm simulate:vapi-tool-call`, and docs/going-live.md section 4, step 7
  (the tool's JSON, its credential, the line for the assistant's prompt).
  "Test what the AI finds" on /knowledge also shows the phone assistant's
  line. BLOCKED only for a real call (no Vapi account): the tool-calls
  message, the answer and the signing of tool requests follow Vapi's docs
  (docs/research/vapi-tools-media-anthropic.md, section 1), like the rest of
  Vapi. typecheck, lint, 524 checks (0 failures, 16 new) and the build pass
  (every /api route ƒ); the drift check finds no schema changes. Evidence, by
  check file:
  - vapi-tool-checks: "vapi tool: a signed search on company A's line
    answers with A's approved support articles only (never B's, drafts,
    archived or marketing-only)", "vapi tool: arguments as an object and as
    a JSON string give the same answer", "vapi tool: an unknown tool, bad
    arguments and an unknown or missing line answer error entries with HTTP
    200, search nothing and record nothing" (also a web call and Vapi's
    nulls), "vapi tool: unsigned, wrongly signed and stale tool calls get 401
    as before...", "vapi tool: every answer is one line of at most 1,500
    characters, best first, a hit too long cut and marked", "vapi tool: no
    match answers plainly that the knowledge base has nothing...", "vapi
    tool: a malformed tool-calls message answers 200 with no results and one
    fixed line...", "vapi tool: the per-company limit refuses with error
    entries (still 200) and one fixed line...", "vapi tool: nothing of the
    query, the answer, the live transcript, the caller or the phone provider
    reaches the logs".
  - vapi-tool-lookup-checks: "vapi tool: each search is recorded under the
    call's Vapi id with article ids and a hit count only, never the question
    or the live transcript" (nothing without a call id), "knowledge test:
    'Test what the AI finds' shows the very line the phone assistant gets for
    the same question", "vapi tool: an answer is given only once its lookup
    is saved...", "vapi tool: the call page lists what the call looked up,
    oldest first, for its own company only; a deleted article shows as
    deleted, another company's never by its title", "vapi tool: the call page
    shows the first 50 lookups of a call and says there are more", "call
    answer: whole hits best first while they fit, at most 3...", "knowledge
    lookups: the database refuses more than 3 hits or more articles than
    hits, and the call page's read has its index".
  - knowledge-checks: the cross-company check also expects the phone line
    ("nothing on this") from "Test what the AI finds".
  - knowledge-text-checks (review fixes): "call answer: each hit in its own
    escaped <article> tags on the one line, so no article can fake a piece,
    close its tag or end the reference text" (a title holding `] [` and
    quotes, a text holding ` | [Account security] End of reference
    text.`, `</article>` and a new tag; a cut never splits an escaped
    character).
  - By hand against `next start` (scratch scripts, their data removed):
    signed tool calls over HTTP (200 JSON; unknown tool, unknown line;
    unsigned 401), the call's end-of-call-report, the call page as its owner
    (titles linked, "nothing found", then "deleted article") and as another
    company's owner (not found), and `pnpm simulate:vapi-tool-call` itself
    (a question, `--call ... --end-call`, an unknown line, no question). The
    server logged fixed lines only.
- Left out on purpose: answering the per-IP limit's 429, its 500 when the
  database fails while counting, or a body over 1 MB (413) with error
  entries (all come before the message is read, as the webhook order says;
  CLAUDE.md known gaps); storing what was asked (call
  content: the page shows what was found); the call brain and the email
  triage reading knowledge (not this step); creating the tool through Vapi's
  API (it is made once, by hand, docs/going-live.md); a retention rule for
  lookups (kept like calls). The plan said step 35 would use
  lib/knowledge/prompt-slice.ts: its <article> blocks have line breaks,
  which Vapi refuses in a tool answer, so the call gets the same escaped
  tags on one line from its own file.

## Stage 3: business profile and onboarding

### Step 36: business profile + onboarding interview  `[x]`
- `business_facts`: one row per company and topic (about 25 topics: company,
  offer, prices, policies, customers, value proposition, goals, brand voice,
  languages, visual identity, words to avoid, competitors, channels, publishing
  frequency, budget, offers...), with a confirmed value and a separate proposed
  value (an AI proposal never overwrites a confirmed fact).
- `onboarding_messages` (encrypted). /cofounder/interview asks one question at
  a time (Claude proposes facts from the owner's answers and the next question;
  without Claude it asks about the next missing topic). Resumable.
- /cofounder/profile: every topic, missing ones marked, completion count,
  confirm / edit / dismiss proposals, "suggest facts from this article".
- Done 2026-10-27 (migration 0030_cofounder_profile; no new dependency or
  setting): business_facts and onboarding_messages (db/schema/), the 25
  topics in lib/business-facts.ts (16 key facts, a fixed question each),
  /db (db/business-facts.ts, business-fact-proposals.ts,
  onboarding-messages.ts), lib/cofounder/ (prompt, turn, reply, proposals,
  suggestions, status, limits, pages, permissions), services
  (business-profile.ts, onboarding-interview.ts, onboarding-turn.ts,
  fact-suggestions.ts, cofounder-overview.ts), two askers with their own
  settings in adapters/claude.ts, app/actions/cofounder.ts and app/cofounder
  (a layout with the section's own row of links, AppFrame's new
  subNavigation; Overview, Interview and Profile pages). "Co-Founder" in the
  header after Knowledge, "/cofounder" in SIGNED_IN_SECTIONS and the proxy;
  the privacy policy and terms describe it. typecheck, lint, 550 checks (0
  failures, 25 new) and the build pass (every /api route ƒ); the drift check
  finds no schema changes, and all 31 migrations apply to a fresh database.
  Evidence, by check file:
  - cofounder-interview-checks: "co-founder interview: the first answer
    saves the opening question the page showed, then the answer, then
    Claude's question; its facts become proposals", "... the opening saved is
    the question the page showed, even after the profile changed; an answer
    to a conversation started over meanwhile is refused", "... without a
    usable answer from Claude the answer is still saved, nothing is
    proposed, and the fixed question of the first missing key topic comes
    next" (no key, refused, failed, cut off, not JSON, an extra company
    field, a blank question, another shape, a field missing), "... Claude's
    odd entries are dropped one by one (unknown topics, empty values, other
    shapes); values are cut to 2,000, the question to one plain line of
    500", "... Claude ends the interview only when no key topic is missing
    (counting what it proposes); otherwise the fixed question of the missing
    one comes next" (with the completion count).
  - cofounder-interview-control-checks: "... Start over deletes the messages
    and never the facts; a reply whose answer was deleted meanwhile saves
    nothing", "... members read the interview but can't answer or start over
    (services and /db); an owner made a member meanwhile is refused", "...
    the per-company hourly limit refuses an answer before it is saved or
    read; another company still answers".
  - cofounder-prompt-checks: "... Claude gets only this company's facts and
    newest 12 messages, each in escaped tags the owner's text can't close;
    card numbers hidden", "... messages are encrypted at rest with a context
    naming the company and the message; a copy on another row or in another
    company can't be read", "co-founder: the schemas sent to the API and our
    own checks of the answers agree; a company, message or person field
    makes an answer unusable", "business profile: the database's topic CHECK
    lists exactly the code's topics, and its source CHECKs the code's
    sources".
  - cofounder-profile-checks: "business profile: another company can't
    read, confirm, dismiss or edit a company's facts or proposals (services
    and /db)" (and the database refuses a confirmer or an interview author
    from another company), "... a proposal never overwrites a confirmed
    value; Confirm makes it the fact with its source, Edit and confirm and an
    owner's edit record the owner", "... a confirm or dismiss of a proposal
    changed meanwhile, or an edit of a fact changed meanwhile, is refused and
    changes nothing" (two first saves at the same moment: exactly one wins).
  - cofounder-profile-rule-checks: "... members read the profile but can't
    confirm, edit or dismiss (services and /db); an owner made a member
    meanwhile is refused", "... the completion counts confirmed key facts
    only, and the Overview's next steps follow it (owners only)", "... a fact
    is 1-2,000 characters with a line break counting once; control
    characters and unknown topics are refused; the database CHECKs hold",
    "trusted fields: proposals carrying a company, a confirmed value or a
    source of their own write only the proposal, for the company given".
  - cofounder-suggestion-checks: the three "suggest facts: ..." checks (an
    approved article of the company's own read in escaped <article> tags,
    proposals only; another company's article, a draft, an archived one, a
    bad id or a member refused without asking Claude; a failure logs one
    fixed line, a long article is read in its first pieces only), "co-founder
    limits: ..." and "co-founder: the header links Co-Founder right after
    Knowledge, /cofounder needs a login, and the sub-navigation lists exactly
    the pages under app/cofounder".
  - claude-adapter-checks: "Claude adapter: the Co-Founder's interview and
    its suggestions from knowledge each send their own settings, lighter than
    a call decision's" (new); the no-key, 300-second and cut-off checks now
    cover both new askers. stuck-work-checks: the time budget check lists the
    Interview and Profile pages (maxDuration = 300). login-redirect-checks
    cover /cofounder through SIGNED_IN_SECTIONS.
  - Each of 9 deliberate bugs (a proposal saved over an equal confirmed
    value, no escaping in the prompt, no role check in /db, an early end, a
    confirm without the proposal shown, the profile read or the newest
    messages without the company, an encryption context without the company,
    no rate limit) made its check fail; all undone.
  - By hand against `next start` (scratch scripts, their data removed): every
    page fetched as an owner, a member, another company's owner and logged
    out (307 to /login?next=...); then headless Chrome driven through the
    real forms, Claude's calls going to a local fake Messages API
    (ANTHROPIC_BASE_URL with a fake key; no real call): an answer (Claude's
    next question, "Proposed from your answer: Business name.", the box
    emptied), an answer the AI can't read (the notice links the topic, the
    fixed question follows), a refused answer kept in the box, Confirm,
    "Fill in" ("Saved."), "Suggest facts" (the menu keeps the article), Edit
    and confirm, a repeated fact proposing nothing, Start over (the facts
    kept), a member with no answer box and no buttons, and no page scrolling
    sideways at 375 px. The server logged no error.
  - Review fixes (8 findings, all real; two were one defect), each new check
    seen failing on the code before its fix. cofounder-suggestion-checks:
    the refusal check also refuses an approved article ticked for neither
    support nor marketing (the menu leaves it out and lists a
    marketing-only one), and "suggest facts: the menu lists every approved
    article a company can have (1,000), by title, so none is left out" (it
    stopped at 500). cofounder-prompt-checks: "co-founder prompts: a cut
    never splits an emoji..." (a fact cut at 300 and an older message cut
    at 1,000 sent half an emoji). cofounder-profile-checks: "business
    profile: Confirm and Edit and confirm are refused when the confirmed
    value changed after the page showed it; the newer value stays".
    cofounder-interview-control-checks: "co-founder interview: Start over
    waits for the company's row lock...", "... a reply being saved when
    Start over begins is deleted with the rest, never left behind as a lone
    question" (it was left behind), and "... an answer is 1-4,000 characters
    with a line break counting once, as the box counts..." (the server's
    limit had no check). cofounder-interview-checks: "co-founder interview:
    a key proposal dismissed after the interview ended opens it again...".
- Decisions where the spec left room: the first question is the fixed
  question of the first missing key topic after a short introduction, saved
  with the first answer as the page showed it (the form names its topic, so
  a profile changed meanwhile can't change the question answered); a turn
  with unknown topics keeps the rest (only those entries drop, as the spec's
  "dropped" says), while a malformed turn drops whole and the fixed question
  follows; without a usable turn the saved reply starts with a fixed note
  ("I couldn't read that answer just now..."), so the conversation still
  explains a question that comes back; Claude's interview_complete counts
  only when no key topic is missing, its proposals included; an owner typing
  exactly what waits clears the proposal; Dismiss doesn't ask first (only a
  proposal goes, and the owner can type the fact; the spec asks for the
  ConfirmButton on Start over); members see the section read-only, owners do
  everything. "Suggest facts from knowledge" takes any approved article
  ticked for support or marketing (the spec's "marketing or support"), since
  nothing counts until an owner confirms; review fixes: not one ticked for
  neither, whose page says nothing uses it.
- Left out: nothing of the spec ("Suggest facts from knowledge", marked
  optional, is built). Not built on purpose: a history of earlier values,
  which article a proposal came from, deleting a single message, members
  proposing facts, and anything that uses the facts yet (steps 37 and on).

## Stage 4: the AI Co-Founder

### Step 37: marketing strategy  `[x]`
- `marketing_plans` (versioned). Claude builds a plan from confirmed facts and
  approved marketing knowledge (plus category counts only if the owner turned
  that on): audiences, positioning, goals, content pillars, campaigns, cadence
  per platform, and every statement labeled fact / assumption / suggestion
  ("fact" must name a confirmed topic or it is shown as an assumption).
- Refuses to plan (and says what is missing) without the key facts.
- Done 2026-10-27 (migration 0031_marketing_plans; no new dependency or
  setting): marketing_plans (db/schema/marketing-plans.ts) and
  companies.cofounder_uses_support_trends; lib/marketing-plan/ (limits, the
  plan's Zod schema and the JSON schema sent to the API, the statement
  bases, the fact rule, the answer reader, the prompt, readiness) and
  lib/social-platforms.ts; /db (marketing-plans.ts, cofounder-settings.ts,
  support-trends.ts); services (marketing-plan.ts, marketing-plan-inputs.ts,
  marketing-strategy.ts; cofounder-overview.ts names the current plan);
  askClaudeForMarketingPlan with MARKETING_PLAN_SETTINGS in
  adapters/claude.ts; app/actions/marketing-strategy.ts; /cofounder/strategy
  (the current plan, "Make a new plan", the support-trends setting, every
  version) and /cofounder/strategy/[version] with its not-found page;
  "Strategy" in the Co-Founder's row of links, which now sits in <Suspense>
  (the version page's number would otherwise stop the build); the privacy
  policy, the terms, docs/going-live.md and the startup warning for a missing
  ANTHROPIC_API_KEY say what plans send and store. typecheck, lint, 576
  checks (0 failures, 19 new) and the build pass (every /api route ƒ); the
  drift check finds no schema changes, and all 32 migrations apply to a
  fresh database. Evidence, by check file:
  - marketing-plan-checks: "marketing plan: another company can't read a
    company's plans, versions or setting, and each company numbers its own
    versions (services and /db)" (Postgres refuses a maker from another
    company), "... members read the strategy but can't make a plan or change
    the setting (services and /db); an owner made a member meanwhile is
    refused", "... versions are numbered 1, 2, 3, ... per company, also for
    plans saved at the same moment, each with its own note" (five through
    the service and five through /db at once), "... the hourly limit per
    company refuses before Claude is asked, for every owner; another company
    still plans", "... the support-trends setting is off by default; owners
    turn it on and off; an odd value or too many changes are refused".
  - marketing-plan-prompt-checks: "... without what a plan needs Claude is
    never asked, and the page lists what is missing; a proposal doesn't
    count, products or services is enough", "... Claude gets only this
    company's confirmed facts (never a proposal) and the owner's note, each
    in escaped tags it can't close; card numbers hidden; nothing about the
    account", "... Claude reads approved marketing articles only (never
    support-only, drafts, archived or another company's), whole pieces
    within 6,000 characters, and the plan names them", "... support trends
    reach Claude only while the setting is on, and then only category names
    and ticket counts of the last 30 days".
  - marketing-plan-answer-checks: "... a failed, refused, cut-off or unusable
    answer saves nothing and says so plainly; a failure logs one fixed
    line", "... an answer of another shape is unusable: ...", "... a 'fact'
    naming no confirmed fact that was sent is stored and shown as an
    assumption; one naming only sent facts stays a fact, whatever the row
    says".
  - marketing-plan-schema-checks: "... the schema sent to the API and our
    own check of the answer agree at every level; a company, version or
    person field makes an answer unusable", "... texts become one plain line
    cut at a word with '...', lists keep their first entries, posts a week
    are rounded to one decimal, and blank, repeated or zero entries drop",
    "trusted fields: a plan carrying a company, version or maker of its own
    is saved for the company, the next version and the person given".
  - marketing-plan-page-checks: "... the Strategy page shows the current
    plan, who made it and from what, every version, and says when the
    profile changed since" (bad version numbers, a stored plan this code
    can't read), "... the note is 0-1,000 characters with a line break
    counting once; control characters are refused before Claude is asked;
    the database's CHECKs hold".
  - claude-adapter-plan-checks: "Claude adapter: a marketing plan sends its
    own settings: effort high, room for the whole plan, one long try", "...
    a marketing plan is tried once: a 500 or a 429 is not retried, and a
    plan that never comes is cut off at its longest run". Extended:
    claude-adapter-checks (the no-key and 300-second checks cover the plan;
    its fakes moved to claude-fakes.ts), stuck-work-checks (the time budget
    check lists the Strategy page), cofounder-suggestion-checks (the
    sub-navigation check covers Strategy and its version pages).
  - Each of 17 deliberate bugs (no company lock when numbering versions,
    proposals sent as facts, support articles read for marketing, trends
    sent whatever the setting, Claude asked without the key facts, no fact
    rule, no role check in /db for a plan or for the setting, facts or the
    note not escaped, a version or the setting read without the company, no
    hourly limit, extra fields allowed in an answer, trends counted across
    companies or without the 30-day window, articles named that the prompt
    didn't hold) made a check fail; all undone.
  - By hand against `next start` (scratch scripts, their data removed), with
    Claude's calls going to a local fake Messages API (ANTHROPIC_BASE_URL and
    a fake key; no real call), headless Chrome through the real forms: the
    missing facts listed and linked, no form; once confirmed, the form and
    the setting (saved, still on after a reload); an answer the app can't
    use (nothing saved, the note kept, its message shown; review fixes: no
    longer by marking the box); a plan (badges Fact,
    Assumption, Assumption, Suggestion: a "fact" about unconfirmed prices
    shown as an assumption; who made it and from what; the box emptied; the
    request the running app sent held the facts, the unconfirmed topics and
    `<category name="Billing" tickets="2"/>`, no ticket text); a second
    version, version 1's page and its links, /cofounder/strategy/99 not
    found, the Overview's line; a member without form or checkbox; another
    company finding neither the plan nor version 1; no page scrolling
    sideways at 375 px; logged out, a 307 to /login?next=.... The server
    logged no error. Screenshots checked by eye (the legend now lines up its
    meanings).
  - Review fixes (6 findings, all real), each new check seen failing on the
    code before its fix. marketing-plan-search-checks: "search query:
    several texts take turns at the 20 words..." and "marketing plan: a
    long products list leaves the services and goals facts their share of
    the article search, so articles matching only them are read" (joined,
    the products list filled the 20 words). page-heading-checks: "pages:
    every page of a signed-in section has a level-1 heading..." (the
    version page had none). By hand, the same way as above: a member's
    missing-facts box says only owners answer and confirm, with links to
    read both; the note's own error marks the box, the AI's "can't be
    used" message shows apart with the box unmarked and the note kept, and
    neither shows while a new try runs; the new intro and Fact legend;
    version 1's page with one h1 and no heading level skipped; nothing
    scrolling sideways at 375 px. The server logged no error.
- Decisions where the spec left room: versions are the newest + 1 under the
  company row lock (no counter column), and each has its own page,
  /cofounder/strategy/<n>, linked to the one before and after (the Strategy
  page lists the newest 50); "key facts" = What the business does, Products
  or Services (either), Target customers, confirmed (a proposal never
  counts); the articles are found by the words of the confirmed products,
  services and goals facts, taking turns at the search's 20 words (review
  fixes: joined, a long products list left the other two out), and
  knowledge_used names the ones whose pieces
  made it into the 6,000-character slice; facts are sent whole, and the
  unconfirmed topics by key and label, so Claude can say what is missing;
  texts are cut at a word with "..." and long lists trimmed rather than
  refused (a plan takes minutes), while a missing minimum (summary,
  positioning, 1 audience, 1 goal, 3 pillars, 1 campaign, 1 posting cadence,
  1 statement) refuses; posts a week 0-14, rounded to one decimal, entries
  of 0 dropped; the fact rule runs again on every stored plan shown, against
  its own facts_used; plans and notes are plain JSON / text like the facts
  (the box says to keep customers' details out); one try of 270 s at effort
  high with 16,000 tokens; 10 plans an hour per company, counted only once a
  plan can be made, and the setting on the settings-changes limit; the
  setting lives on the Strategy page (not Setup), and used_support_trends
  means it was on (even with no tickets); the trends count tickets created
  in the last 30 days that have a category (archived ones too), at most 100
  categories; the Overview got a "Marketing plan" section (its next steps
  are unchanged); the plan says when the confirmed facts changed since.
- Left out: nothing of the spec, except what it puts later: the performance
  summary (step 42 makes it). Not built on purpose: web research (decision
  10), deleting, editing or comparing plans, and platforms other than the
  four (Instagram or TikTok can only be named in a text).

### Step 38: content studio  `[x]`
- `content_drafts` per platform and format (post, image post, video script /
  concept), with claims Claude marks and checks against confirmed facts.
- Platform rules (lengths, hashtags, required media) checked in code.
- Generate, edit, regenerate, preview, approve (owner; unsupported claims must
  be acknowledged), reject, archive. Editing an approved draft revokes approval.
- Done 2026-10-27 (migration 0032_content_drafts; no new dependency or
  setting): content_drafts (db/schema/content-drafts.ts); the platform rules
  in lib/content-rules.ts with their helpers in lib/content-studio/ (X's
  weighted count, text measures, hashtags, words to avoid, the feed cut,
  live counts, claims, the review, the AI's answer, its JSON schema and the
  prompt; formats, limits, draft fields); /db (content-drafts.ts,
  content-draft-writes.ts, content-draft-status.ts, content-draft-rows.ts;
  readConfirmedFactValues in business-facts.ts); services (content-drafts.ts,
  content-generation.ts, content-generation-inputs.ts, content-draft-edits.ts,
  content-review.ts, content-draft-messages.ts); askClaudeForContentDraft
  with CONTENT_DRAFT_SETTINGS in adapters/claude.ts;
  app/actions/content-studio.ts; /cofounder/studio (list), /new and /[draftId]
  with its not-found page; "Studio" in the Co-Founder's row of links; the
  shared app/cofounder/missing-facts.tsx (moved from strategy/). Privacy
  policy, terms, docs/going-live.md and the missing-key startup warning say
  what drafts store and send. Found in the run against `next start`: a
  failed Claude request was logged (and stored for calls) under a minified
  class name ("m"); adapters/claude-errors.ts names the SDK's errors by
  their classes. typecheck, lint, 612 checks (0 failures, 33 new) and the
  build pass (every /api route ƒ); the drift check finds no schema changes.
  Evidence, by check file:
  - content-rules-checks: "content rules: X counts as X does: 280 letters
    fit and 281 don't, a Chinese or Japanese character counts 2, an emoji 2
    (a family or a flag too), a link 23 whatever its length", "content
    rules: YouTube takes videos only, each needing its video, a title of at
    most 100 characters and no < or >; its description counts bytes",
    "content rules: at most 10 hashtags on every platform (blocking), X
    warns above 2, ...; an image post and a video need their media",
    "content rules: LinkedIn takes 3,000 characters and Facebook 63,206; the
    live counts are the rules' own counts", "words to avoid: read from the
    fact at commas, semicolons and lines, matched as whole words or phrases
    in any case, ...; 'None.' lists nothing", "feed preview: ..." and
    "hashtags: ...".
  - content-draft-checks: "content studio: another company can't list,
    count, read, edit, regenerate, approve, reject, archive or restore a
    company's drafts (services and /db)", "content studio: Postgres refuses
    a person or a plan version from another company, an approval of a
    version that moved on, a title off YouTube and a text post on YouTube",
    "content studio: the database's CHECKs list exactly the code's
    platforms, formats and statuses", "trusted fields: an edit carrying a
    company, status, version, approval, claims or another draft's id of its
    own writes only what the editor may change".
  - content-draft-review-checks: "content studio: members write, edit,
    regenerate, archive and restore drafts, but can't approve or reject them
    (services and /db); an owner made a member meanwhile is refused", "...
    a blocking issue stops approval, checked on the saved draft in the
    approving transaction: X's length, a word to avoid confirmed after the
    page showed the draft, a video without its video", "... a claim no
    confirmed fact backs needs 'I checked these claims', and so does a text
    written or changed by hand or a fact changed since; the owner who ticked
    it is recorded", "... rejecting (owners) keeps the note through edits
    until an approval; ...".
  - content-draft-change-checks: "content studio: an approval records its
    version; editing or regenerating an approved draft makes it a draft
    again without its approval, as the next version; an edit changing
    nothing keeps it", "... an edit, approval or rejection of a version that
    moved on is refused and changes nothing; of five saves at the same
    moment exactly one wins", "... the AI's new text is never saved over an
    edit made while it was writing; an archived draft is never regenerated
    (no Claude call)", "... Archive takes an approval away ...; Restore
    makes it a draft (an idea when empty) to be approved again".
  - content-generation-checks: "content studio: the AI can't mark its own
    claim supported: this code backs a claim only when every fact it names
    was confirmed and sent, a 'supported' field makes the answer unusable,
    and a stored claim is checked again", "... a failed, refused, cut-off or
    unusable answer changes nothing: no new draft, a regenerated draft keeps
    its content, and a failure logs one fixed line", "... without the key
    facts Claude is never asked ...; a blank draft still works", "... the
    hourly limit per company refuses before Claude is asked, for everyone
    in it; another company still writes; blank drafts count per person".
  - content-prompt-checks: "content studio: Claude gets only this company's
    confirmed facts (never a proposal), approved marketing articles, the
    plan's pillar, campaign, positioning and audiences and the words to
    avoid, each escaped, card numbers hidden, nothing about the account",
    "... Claude is told the platform's own rules ...", "... the schema sent
    to the API and our own check of the answer agree at every level ...",
    "... the AI's texts are cleaned and cut, never refused for length ...".
  - content-studio-page-checks: the list (50 a page, filters, counts, odd
    filters), the draft page (what the AI wrote it from, the business name,
    edited by hand) and the fields' limits with the database's CHECKs.
  - claude-adapter-draft-checks: "Claude adapter: a content draft sends its
    own settings ...", "... fits the studio pages' 300 seconds: a 500 is
    tried twice, and a 429's hour-long wait or a draft that never comes is
    cut off at its longest run". claude-adapter-checks: "Claude adapter: a
    failed request is named by the SDK's own error class, also when the
    production build shortens class names" (new), and the no-key check
    covers content drafts. stuck-work-checks: the time budget check lists
    the two studio pages (maxDuration = 300); the sub-navigation and
    page-heading checks cover the studio's pages.
  - Each of 24 deliberate bugs was planted alone (a scratch script copying
    the file back after each run): a draft read or the list without the
    company, an edit keeping the approval, no stale check, members approving
    (in /db; and in the service, seen once the check counts a member over
    the limit), blocking issues or the acknowledgment not checked, the
    model's claims trusted, hand edits needing no tick, a changed fact still
    backing a claim, the topic not escaped, support articles read,
    proposals sent as facts, no hourly limit, Claude asked without the key
    facts, X counted as plain length, no hashtag cap, words to avoid
    matched inside words, no YouTube title rule, a claim allowed to say
    "supported", a title kept off YouTube, errors named by their minified
    class. 23 made a check fail; the 24th (the version left out of the
    regeneration's UPDATE) changes nothing, as the locked read refuses a
    stale version first.
  - By hand against `next start` (scratch scripts, their data removed),
    Claude's calls going to a local fake Messages API (ANTHROPIC_BASE_URL
    and a fake key; no real call), headless Chrome through the real forms,
    44 expectations: the empty list and the Studio link marked; New draft's
    format menu following the platform (YouTube: video only) and the plan's
    menus; a LinkedIn draft (heading, badges, the AI's text, live counts,
    the words to avoid listed, the preview cut at "...see more" and opened,
    claims backed and not); a word to avoid typed showing at once as
    blocking, decisions waiting for the save, Undo changes; Approve refused
    without the tick, then approved; an edit making it version 2 without
    the approval; Regenerate asking first, then version 3; the editor
    holding still while the AI writes (a slow answer) and opening again
    once the new version is in; Reject with a
    note; Archive (read-only) and Restore; no page scrolling sideways at 375
    px; an X post over 280 blocked with Approve disabled; a YouTube draft
    with title, script and the missing video; the AI failing (message,
    nothing saved, the topic kept) and Start blank; the list's counts and
    platform filter; a member without Approve or Reject who still edits; and
    another company's owner finding only its own drafts and "We couldn't
    find that draft". The request the running app sent held the platform's
    rules, the pillar, campaign, positioning and audience, the confirmed
    facts, the words to avoid and the approved marketing article, nothing
    else; the failed request was logged as `Claude call failed:
    InternalServerError` (the first run had logged `m`, the minified class).
    Screenshots checked by eye (desktop and 375 px; New draft's two menus
    now line up).
  - Review fixes (8 findings, all real), each new check seen failing on the
    code before its fix (12 old bugs planted one at a time, each caught).
    content-rules-checks: "content rules: checking a long draft reads each
    text a fixed number of times, never once per word to avoid (100 words
    cost no more passes than 1), and X's count of a 63,206-character link
    takes linear time" (before: 201 passes instead of 3, and 2.4 s).
    content-text-checks (new): "content studio: a draft's texts hold at
    most 30 accents or other marks in a row (...): a longer run typed in
    any box is refused, the AI's is cut to 30, and 30 are kept", "... the
    page's review of the longest text a person can save (...), with 100
    words to avoid, takes well under a second (a longer run took
    minutes)", "... a title or call to action keeps the joiners and flag
    tags writing needs (...), typed or written by the AI, and loses the
    characters that hide or reorder text; X counts the joined emoji as 2"
    and "... the editor counts as unsaved exactly what a save would change
    (...); a real change or a bad hashtag is unsaved". content-draft-change-
    checks: the regeneration check also refuses a page showing an older
    version without asking Claude. content-studio-page-checks: "content
    studio: an approval refused for a fact changed after the page loaded
    refreshes the page, which then shows the claim not backed and the 'I
    checked these claims' box". ui-polish-checks: "forms: a menu React
    controls (value=) sits only in forms that send their action from
    onSubmit in a transition, ..." (its source helpers moved to
    source-helpers.ts). Measured before the fixes (Node 22): normalizing
    the crafted 63,205-character body took 2.3 s, one rules check 2.3 s
    with no word to avoid and 9.2 s with 3, and a run of half-width sound
    marks (U+FF9E, not a \p{M} character) 1.1 s under NFKC, so they count
    in the bound; after: that body is refused in 4 ms, and the longest
    allowed body is checked against 100 words in about 4 ms once warm
    (125 ms the first time). The menu reset was reproduced in headless
    Chrome with React 19.3 (a scratch page): after a refusal the menu showed
    LinkedIn while the state said YouTube, and the second press sent
    linkedin; sent from onSubmit, it sent youtube both times, with the
    pressed button's mode.
- Decisions where the spec left room: Archive and Restore are for anyone in
  the company (nothing is published by them, and an edit can already take
  an approval away), Restore makes a draft (or an idea) to be approved
  again; a blank draft is an "idea" until something is written; platform
  and format are fixed when a draft is made; the published text is body,
  call to action and hashtags, each its own paragraph, and every limit
  counts all of it; an image post needs its image and a video its video
  (so only text posts can be approved before step 39); YouTube's
  description counts bytes and refuses < and > (its API's own rules); a
  draft holds up to 30 hashtags while the rule blocks above 10, and X warns
  above 2; words to avoid are the confirmed fact split at commas,
  semicolons and lines, matched as whole words in any case, an English
  "None"-like fact meaning none; four columns the spec doesn't list
  (generated_version, facts_used, knowledge_used, plan_version) record
  what the AI wrote and read, so a hand edit is known (Regenerate asks
  first, the claims list is out of date) and a claim is checked again
  against the facts it was written from; "I checked these claims" is also
  needed for a text changed or written by hand; a rejection and its note
  stay through edits until an approval; the AI writes only once what a plan
  needs is confirmed (a blank draft needs nothing); an answer with a field
  we didn't ask for or more than 30 claims is unusable, texts are cut to
  the columns only; settings effort medium, 12,000 tokens, 120 s, 1 retry;
  limits 30 AI texts an hour per company and 120 changes per 10 minutes per
  person; the list starts on "Current" (everything but archived); the
  preview's cut is about 210 characters or 3 lines on LinkedIn, 480 or 5 on
  Facebook, 160 or 3 for a YouTube description, none on X, and it uses the
  confirmed business name.
- Left out: nothing of the spec. Put later by the spec itself: the
  media_asset_id column (step 39) and the history of who did what
  (cofounder_activity, step 41; the who/when columns are kept). Not built on
  purpose: deleting drafts (the spec: archive), changing a draft's platform
  or format, a cap on drafts per company (rate limits only), and anything
  that publishes (steps 40-41). Fixed beyond the spec: Claude's error class
  names in a production build (adapters/claude-errors.ts); other
  constructor.name log lines are a known gap in CLAUDE.md.

### Step 39: media library + generation jobs  `[x]`
- `media_assets` (uploads checked by extension AND file signature, private
  storage under media/<companyId>/...) and `media_generation_jobs` (queued /
  running / succeeded / failed, attempts, error code, cost when known).
- Provider interface + development stand-in; production "not set up" until a
  provider is chosen (OPEN). A failed job never shows an asset.
- Done 2026-10-28 (migration 0033_media_library; no new dependency; one new
  setting, MEDIA_PROVIDER). A real image or video service stays OPEN
  (decision 9): the step builds everything around one, and production says
  generation isn't set up until it is chosen. Built:
  media_assets and media_generation_jobs (db/schema/media.ts) and
  content_drafts.media_asset_id; the lists in lib/media/ (kinds, limits,
  files, signatures, dimensions, error codes); the provider interface and
  the mode in lib/media-generation.ts and the stand-in in
  adapters/dev-media-generator.ts (a 1024 x 1024 PNG built with node:zlib,
  one colour from the prompt's hash; no video); lib/allowed-host-download.ts
  (the recording download made general); /db (media-assets.ts,
  media-asset-deletion.ts, media-generation-jobs.ts, media-generation-runs.ts,
  content-draft-media.ts; findStuckGenerationJobs in stuck-work.ts);
  services (media-library.ts, media-deletion.ts, media-files.ts,
  media-generation-jobs.ts, media-generation-runs.ts,
  media-provider-calls.ts, draft-media.ts;
  stuck-work.ts runs stuck requests in turn with emails and calls);
  app/actions/media.ts; GET /api/media/[assetId] (inlineMediaResponse);
  /cofounder/media (upload, "Generate an image", requests with Cancel and
  "Start now", the library grid with badges, alt text and Delete) and a
  Media panel on a draft's page (the attached image or video, "Take it off
  the draft", "Make the image with the AI", the picker; the preview shows
  it; the rules see it). "Media" in the Co-Founder's row of links. Privacy
  policy, terms, docs/going-live.md (section 2's media/ files, the image
  service paragraph in section 7, hosting, errors, monitoring),
  .env.example and the startup warnings say what it stores and needs.
  typecheck, lint, 655 checks (0 failures, 36 new) and the build
  pass (every /api route ƒ, /api/media/[assetId] too); the drift check finds
  no schema changes. Evidence, by check file:
  - media-file-checks: "media files: each accepted type is told by its own
    first bytes, and anything else is not (a script, an SVG, a HEIF photo, a
    PDF, too few bytes)", "media files: a PNG named .jpg, a script named
    .png and an SVG are refused, in the browser's check and on the server,
    and nothing is stored", "media files: at most 4 MB (one byte more is
    refused before anything is stored), and an empty file is refused",
    "media files: an upload is stored under
    media/<companyId>/<assetId>.<ext>, with the type its bytes say, its
    size, its image size, and its name as one plain line", "image sizes:
    PNG, GIF, WebP and JPEG headers give their width and height; a
    cut-short or odd header, and a video, give none", "dev stand-in: a real
    PNG of 1024 x 1024 in one colour from the prompt (the same prompt, the
    same colour), and no video".
  - media-library-checks: "media library: another company can't list,
    count, serve, describe or delete a company's images (services and
    /db); its own team can", "media route: a file is shown inline with the
    type we stored, nosniff and a sandbox, never cached; an unknown id
    answers 404 and too many 429", "media library: Postgres refuses a key
    outside the company's folder or not made from the asset's id, a person
    or job from another company, an upload with a job, a generated file
    without one, and an unknown type", "media library: the database's
    CHECKs list exactly the code's kinds, sources, types and job
    statuses", "media library: alt text is saved as one plain line of at
    most 1,000 characters; 1,001 is refused and changes nothing", "media
    library: one person's uploads are limited (30 per 10 minutes, another
    person still uploads), and storage refusing a file is a message,
    logged without its name or key".
  - media-generation-checks: "media generation: in development the
    stand-in makes the image after the answer: a real PNG under the
    company's folder, marked as the stand-in's, its job succeeded and
    linked, free", "media generation: the stand-in makes no video: the job
    fails with 'no_video_provider', in plain words, and never has an
    asset", "media generation: production without a real service is off
    (no job is made), the stand-in is refused there even when named, and a
    stand-in's job is never run by it" (with the startup warnings and a
    wrong MEDIA_PROVIDER stopping the server), "media generation: a prompt
    is 1-2,000 characters, a line break counting once; control characters
    and an unknown kind are refused before anything is saved", "media
    generation: Postgres refuses a job that failed without a code or with a
    message, an asset on an unfinished or failed job, a success without
    one, and a person, draft or asset of another company", "media
    generation: the company's daily limit refuses before anything is saved
    or run, for everyone in it; another company still asks".
  - media-job-checks: "generation jobs: five runs of one request at the
    same moment make one request to the service and one asset",
    "generation jobs: a run cut off is taken up 15 minutes later, at most 3
    times in all, then ended as 'interrupted' without an asset; a run going
    on now is left alone", "generation jobs: a service working in the
    background is polled with the id it gave, kept before the first poll;
    a later run polls it, never asks again", "generation jobs: a result is
    fetched only over https from the service's own host (every redirect
    too), and kept only when its bytes are of the kind asked; otherwise a
    code and never an asset", "generation jobs: a service that throws,
    refuses or never answers fails the job with its code (provider_failed,
    provider_refused, provider_timeout), never an asset".
  - media-job-control-checks: "generation jobs: another company can't
    list, run or cancel a company's request; Cancel works only while it
    waits, for anyone in the company; a canceled one is never run",
    "generation jobs: 'Start now' runs a stuck request (waiting 2+ minutes,
    or cut off 15+ minutes ago) after the answer, and refuses one that
    isn't stuck or isn't the company's", "stuck work: the scheduled job
    finds stuck image requests of every company (never fresh ones) and runs
    them through their own path, only while their slowest run still fits",
    "media cap: a company keeps at most 300 files and 500 MB, uploads and
    generated files together; another company's don't count; a request is
    refused when it is full", "generation jobs: no prompt, address of the
    service or file key reaches the logs; a failure logs its code".
  - media-draft-checks: "draft media: attaching an image to an approved
    post with an image makes it a draft again, without its approval, as
    the next version; Approve then sees the image", "draft media: the wrong
    kind, a text post, another company's asset, an archived draft and a
    version that moved on are refused (services and /db), changing
    nothing", "draft media: an idea with an image attached is a draft, and
    an idea again once it is taken off; attaching the same one again
    changes nothing", "draft media: 'Make the image with the AI' uses the
    saved image description; the stand-in's image is attached as the next
    version, taking an approval away", "draft media: 'Make the image with
    the AI' is refused for a version that moved on, without a description,
    on a video, and for another company; a draft archived meanwhile keeps
    its version, the image stays in the library".
  - media-delete-checks: "media delete: refused while an approved,
    scheduled, published or failed draft uses it, naming the draft;
    nothing changes", "media delete: drafts using it lose it as their next
    version (an archived one stays archived), the job that made it keeps
    its history, and the file goes", "media delete: an attach, or an
    approval, at the same moment as a delete never leaves a draft with a
    deleted image, nor an approved draft without its image" (five rounds
    each).
  - Extended: stuck-work-checks (the new turn-taking counts; the time
    budget check lists the media page), ops-checks (the job's counts).
    content-draft-review-checks' "needs its video" still holds with the new
    wording; the sub-navigation and page-heading checks cover the media page.
  - Each of 24 deliberate bugs was planted alone (a scratch script copying
    the file back after each run) and made the check meant for it fail: a
    list, a file read or an alt text change without the company, no check
    that name and bytes agree, a HEIF photo taken for a video, a key
    without the company, a claim of any status, no cap on runs, the kind of
    a result not checked, redirects not checked, the stand-in allowed in
    production, an attach keeping the approval, an attach of any kind, a
    delete ignoring approved drafts, no daily limit, no storage cap, no
    view limit, Cancel while being made, any service running any job, no
    nosniff, an archived draft getting its image, the rules never seeing
    the media, a service's failure left unfinished, control characters in
    a prompt; all undone.
  - By hand (scratch scripts, their data removed), headless Chrome through
    the real forms: against `next start` (production: generation off, 32
    expectations, run again on the final build with 6 more for the last
    fixes) and against `next dev` (the stand-in, 36). Logged out, the
    page answered 307 to /login?next=%2Fcofounder%2Fmedia and a file 401. Media
    in the row of links, marked; production says generation isn't set up
    (no form, no setting named), development names the stand-in. The
    browser refused a PNG named .jpg, an SVG and a 5 MB file at once and
    sent nothing; a real PNG uploaded and listed (badge, name, type, size,
    pixels), drawn at 1,024 pixels from /api/media, which answered
    image/png, nosniff, inline, private no-store and the sandbox; another
    company's id 404. Alt text saved, kept after a reload. "Make it": the
    stand-in's image marked AI-generated and Development stand-in, the
    request Done with its link, the box emptied; a video Failed in plain
    words, nothing made; a refused prompt kept its text and menu. A draft:
    Media and Checks said the image was missing; "Use this" made version 3
    with the image in Media and the Preview, the problem gone; approved;
    "Make the image with the AI" attached the stand-in's image as version
    4, the approval gone (production: "Image generation isn't set up
    yet..."). The image an approved draft used listed it and offered no
    Delete; another was deleted after asking, its address then 404. A
    member uploads and asks; another company's owner saw only its own image
    and not the draft. 375 px: no sideways scrolling. Found and fixed by
    it: the upload box's fixed width widened the page to 409 px on a phone;
    the editor's fields spread apart beside the taller Media column; the
    picker's cards overlapped (a generated image's two badges pushed its
    card over the next). The servers logged no error; `next start`
    printed the MEDIA_PROVIDER warning. Also seen: a browser profile moved
    from `next start` to `next dev` keeps production's cookies, and the
    login page then reloads itself in a loop (development only; a fresh
    profile logs in as usual).
- Decisions where the spec left room: everyone in the company uses the
  library (upload, describe, delete, ask, cancel), as in the studio; a draft
  that failed to publish keeps its media too (step 41 may retry it); a
  deleted generated asset leaves its job "succeeded" with asset_deleted_at
  (the spec's "succeeded <=> asset" holds otherwise, CHECKs both ways); the
  row is deleted before the file (the draft rules decide in the row's
  transaction; a failed file delete is logged); media counts as content (an
  idea with an image is a draft); "Make the image with the AI" is for posts
  with an image only (a video's image description is its thumbnail, and a
  draft holds one file), from the SAVED description at the version shown,
  attached only while the draft is still at that version (review fix: a
  stuck request run later replaced an approved image), one at a time per
  draft (review fix: the draft's row locked and a unique index; a new one
  over a stuck one ends it "superseded"), and the editor waits until the
  image lands (the page refreshes itself); a change of media alone keeps the
  AI's text the AI's (review fix: generated_version comes along); alt text
  is published with the file, so a change is the next version of every draft
  using it (review fix); a video request is saved and fails honestly on the
  stand-in (the spec's "the job fails"); a request still queued 2 minutes
  after it was made is stuck (the daily job and "Start now" take it); the
  job list shows the newest 20; generated images get no alt text (a person
  writes it); the start of a background job that never answers in time fails
  it ("provider_timeout"), never asks again; a result URL may say any image,
  video or octet-stream type (its bytes decide); 30 requests a day, 300
  files and 500 MB per company (open requests count as files; a generated
  file is checked again when saved), 30 uploads per 10 minutes and 1,000
  file views per 10 minutes per person; the job also runs stuck requests
  within its time budget (LONGEST_GENERATION_MS, 170 s);
  lib/allowed-host-download.ts gives recordings one 60 s limit for the whole
  download (it was 30 s per redirect).
- Left out: nothing of the spec. Not built on purpose: a real image or video
  service (OPEN), uploads straight to R2 for big videos, thumbnails, video
  sizes and lengths, range requests in the development stand-in,
  generating a video (or a thumbnail) from a video draft, alt text by the
  AI, editing or cropping images, filters on the library, and anything that
  publishes (steps 40-41).
- Review fixes, 2026-10-28 (11 findings, all real; migration
  0034_media_request_versions; no new dependency or setting): alt text is
  part of every draft using the image (db/media-alt-text.ts: the next
  version without approval; refused while one is scheduled, published or
  failed; words to avoid read in it); a change of media alone carries
  generated_version along; requests from a draft record its version and
  attach only at it, one open per draft (db/media-generation-requests.ts,
  a unique index; a stuck one is ended "superseded"); "Start now" claims
  before answering (services/media-generation-control.ts); open requests
  count toward the cap and a generated file is checked again when saved
  ("library_full"); a failed draft request says why on the draft; a result
  over 100 MB is "output_too_large" (services/media-generation-output.ts);
  the upload form keeps its alt text; the preview marks the stand-in;
  library links name their page (lib/media/library-link.ts); JPEG sides
  follow the Exif orientation (lib/media/jpeg-orientation.ts). 14 new
  checks (media-alt-text-checks, media-request-checks, media-ui-checks, and
  one each in media-draft-checks, media-job-control-checks and
  media-file-checks; media-job-checks and content-rules-checks extended);
  typecheck, lint, 669 checks (0 failures) and the build pass. Each of 16
  planted bugs (one per fix, the file copied back after each run) made the
  check meant for it fail.

## Stage 5: publishing

### Step 40: social account connections  `[b]`
- `social_connections` (tokens encrypted per company and connection) and
  `oauth_states` (hashed, single use, 10 minutes, tied to user + company,
  PKCE where the platform supports it).
- One adapter per platform + a stand-in; request shapes checked with fakes.
- /cofounder/accounts: connect, reconnect, disconnect, what each platform can do.
- `[x]` The framework and the stand-in, done 2026-10-28 (migration
  0035_social_connections; no new dependency; 8 new optional settings in
  pairs, LINKEDIN_CLIENT_ID / _SECRET, FACEBOOK_APP_ID / _SECRET, X_CLIENT_ID
  / _SECRET, GOOGLE_CLIENT_ID / _SECRET). `[b]` Real LinkedIn, Facebook, X
  and YouTube: BLOCKED until ansa has their developer apps (decision 7;
  docs/going-live.md, section 10 says what each needs); nothing has met a
  real platform. Built: db/schema/social.ts (social_connections,
  oauth_states), db/oauth-states.ts (an attempt saved with the owner's role
  read again; claimed in ONE UPDATE), db/social-connections.ts (the list,
  never a token; saving, reconnect = the same row by the platform's account
  id), db/social-connection-disconnects.ts (Disconnect; a removed
  teammate's LinkedIn profiles, from db/teammate-access.ts),
  db/social-connection-tokens.ts (renewals guarded by the token they
  replace), deleteExpiredOauthStates in db/maintenance.ts (the daily job);
  lib/social-platforms.ts (kinds, statuses, setting names,
  PUBLISHED_FORMATS, each platform's media, scheduling, metrics and access
  blocker), lib/social-mode.ts (real / stand-in / not set up),
  lib/social-publishing.ts (the one door: buildAuthorizeUrl,
  completeAuthorization, refreshIfNeeded, publishPost, fetchPostMetrics,
  revokeAccess), lib/social-types.ts, lib/social-http.ts (time limits, no
  redirects, capped Zod reads), lib/social-errors.ts (codes and plain
  words), lib/oauth-state.ts, lib/linkedin-text.ts, lib/validation/social.ts;
  adapters/linkedin.ts + linkedin-posts.ts, facebook.ts + facebook-posts.ts
  + facebook-graph.ts, x.ts + x-posts.ts, youtube.ts + youtube-videos.ts,
  dev-social.ts; services/social-connect.ts, social-oauth-callback.ts,
  social-account-saving.ts, social-disconnect.ts, social-tokens.ts
  (prepareConnectionForUse, for steps 41-42), social-accounts.ts,
  social-options.ts; app/actions/social-accounts.ts; GET
  /api/social/[platform]/callback (ƒ in the build, maxDuration 90);
  /cofounder/accounts and "Accounts" in the Co-Founder's row of links. The
  privacy policy, the terms, docs/going-live.md (section 10, errors,
  monitoring, hosting, after the first deploy), .env.example, .gitignore
  (.dev-social/) and the startup warnings (each missing app, a .dev-social/
  folder holding files) say what it stores and needs. typecheck, lint, 708
  checks (0 failures, 39 new) and the build pass (every /api route ƒ); the
  drift check finds no schema changes. Evidence, by check file:
  - social-state-checks: "social accounts: Connect saves only the state's
    SHA-256 hash, for 10 minutes, tied to the person, company and platform;
    X and YouTube get a PKCE verifier stored encrypted and its S256
    challenge in the authorize URL, LinkedIn and Facebook none", "social
    accounts: two returns with one state at the same moment: one connects
    (LinkedIn is asked once), the other is told the link was used, and the
    state never works again", "social accounts: a state works only for the
    person, company and platform that started it, and not after its 10
    minutes; X gets the verifier whose challenge it was shown", "social
    accounts: a refusal, another platform error, a missing code, a missing
    or made-up state and no login each end on a plain message; the address
    and the logs hold nothing the platform sent", "social accounts: an
    owner made a member before coming back connects nothing (the session's
    role, then the role read again in /db)", "social accounts: the daily
    job deletes expired connection attempts, used or not, and keeps fresh
    ones", "social accounts: Postgres refuses an attempt with PKCE where
    the platform has none (or none where it has), longer than 10 minutes,
    a state that isn't a SHA-256 hash, a reused hash and a person of
    another company".
  - social-connection-checks: "social accounts: tokens are stored
    encrypted, with a context naming the company, the connection and the
    token kind; none of the three can be swapped", "social accounts:
    another company can't list, use, renew or disconnect a company's
    connection (services and /db); its own owner can", "social accounts:
    members can't start a connection, connect a stand-in or disconnect
    (services and /db), and nothing is written; members see the page
    without its buttons", "social accounts: reconnecting an account updates
    its own row (same id, new tokens, connected again by whoever
    reconnected); a disconnected one comes back", "social accounts:
    Facebook connects one account per Page the person may create content
    on, each with that Page's own token and no expiry; no such Page, or an
    unticked permission, connects nothing", "social accounts: Disconnect
    deletes the tokens and keeps the row; after the answer X and Google are
    asked to revoke, LinkedIn, Facebook and the stand-in aren't; a failed
    revoke is one fixed line".
  - social-rule-checks: "social accounts: no token, code, state, PKCE
    verifier or app secret reaches the page's data, an address or the logs,
    when connecting works and when it fails", "social accounts: Postgres
    refuses a connected row without a token, tokens on a disconnected one,
    unknown values, a kind that doesn't fit the platform, a second row for
    one account, a message as last_error, a real account under the
    stand-in's id and a person of another company", "social accounts: the
    database's CHECKs list exactly the code's platforms, account kinds and
    statuses", "team: removing a teammate disconnects the LinkedIn profiles
    they connected (those post as them), in the removal itself; the
    company's Pages stay connected".
  - social-adapter-checks: "linkedin: the consent screen, the code exchange
    and the member lookup are the requests LinkedIn documents (no PKCE)",
    "linkedin: a text post and an image post are the Posts and Images API
    requests LinkedIn documents (version 202610, Rest.li 2.0.0); its
    reserved characters are escaped and hashtags kept as LinkedIn's
    template", "linkedin: 422 duplicate, 400, 401, 403, 409 and 429 (with
    its wait) created nothing; 500, 503, a 201 without the post's id and no
    answer are unclear; an upload address off LinkedIn gets nothing, a
    video or WebP no request at all", "facebook: the login dialog, the code
    exchange, the long-lived token, the permissions and the Pages are the
    Graph API v26.0 requests Meta documents, each later call with
    appsecret_proof", "facebook: a text post goes to the Page's /feed and a
    photo to its /photos (source, caption, alt text), with the Page's token
    and appsecret_proof; error codes map as Meta documents them".
  - social-adapter-more-checks: "x: the consent screen (PKCE S256), the
    code exchange (HTTP Basic with the verifier, no client_id in the body),
    users/me, renewing (a new refresh token kept, else the old) and
    revoking are the requests X documents", "x: a post is POST /2/tweets as
    JSON (an image first through the v2 media upload, multipart with
    media_category tweet_image); 429 waits until x-rate-limit-reset, 400,
    401, 403 and 404 created nothing, 503 and a 2xx without data.id are
    unclear", "youtube: Google's consent screen (offline access, the
    consent prompt, PKCE S256, both scopes), the code exchange and
    channels.list are the requests Google documents; no channel or an
    unticked permission connects nothing; renewing: invalid_grant is
    refused, a 503 unavailable", "youtube: a video is the resumable
    videos.insert (a POST with its details and X-Upload headers, then a PUT
    of the bytes to the session address on Google's host); a text post or
    no title asks nothing; a 4xx at the start created nothing, a 503 during
    the upload is unclear, a 404 an expired session", "adapters: a request
    to a platform has a time limit, follows no redirect and is never
    cached; one that never answers is cut off and ends as a timeout, one
    that fails as a network error".
  - social-refresh-checks: "social tokens: an X token that runs out within
    5 minutes is renewed and saved in one UPDATE (X's new refresh token
    kept); one with more time is used as it is, without asking X", "social
    tokens: a refused renewal marks the connection needing a reconnect
    (refresh_refused), shown on the Accounts page; a platform that doesn't
    answer leaves it connected with refresh_unavailable, cleared by the
    next renewal", "social tokens: a LinkedIn token past its 60 days needs
    a reconnect (token_expired) without asking LinkedIn, and the Accounts
    page says so even before; Facebook Page tokens and the stand-in's are
    used as they are", "social tokens: a renewal racing a disconnect never
    brings the tokens back, and one racing another renewal ends with the
    newer token".
  - social-stand-in-checks: "social stand-in: in development a platform
    without its app offers a stand-in account; connecting one asks no
    platform and makes one connection marked as the stand-in's; connecting
    again renews that same one", "social stand-in: publishing through it
    writes .dev-social/<platform>/<time>-<id>.json (the post, never the
    file's bytes) and answers published with a dev id; a YouTube text post
    and a LinkedIn video are refused as the real ones would be", "social
    stand-in: production refuses it, connecting and publishing; there a
    platform without its app is 'not set up': no stand-in, no Connect, no
    setting named, and a real account on it publishes nothing", "social
    stand-in: the startup warnings name each social platform ansa hasn't
    set up and a .dev-social/ folder holding files, never a value; each
    app's id and secret go together, or the server doesn't start", "social
    layer: the consent screen and the code exchange both send
    BETTER_AUTH_URL + /api/social/<platform>/callback as the redirect URI;
    post numbers are 'unavailable' until step 42".
  - social-page-checks: "accounts page: in the Co-Founder's row of links,
    logging in brings people back to it, Disconnect asks first, its buttons
    show for owners only, and nothing on it reads a token", "accounts page:
    the result in its address shows only the callback's codes, for a known
    platform; anything else shows nothing, and every code reads as a plain
    sentence", "accounts route: the platforms' callback stays a thin route
    (the session, the platform and the query handed to the service) that
    reads the request, so it runs on every request (ƒ in the build)".
  - Extended: hygiene-checks (the checks refuse to run with a platform's
    app set), ops-readiness-checks (the stand-in leftovers rule: production
    warns about .dev-social/ whatever is set), stuck-work-checks (the
    cleanup's counts). The sub-navigation, page-heading and login-redirect
    checks cover the new page.
  - Each of 48 deliberate bugs was planted alone (a scratch script copying
    the file back after each run) and made the check meant for it fail:
    the claim ignoring used_at, the person, the expiry or the platform; the
    verifier stored readable; no S256; a token context without its kind;
    the list, a disconnect or the token read without the company; the save
    or the attempt without the role read again; the revoke before the
    answer; a disconnect keeping its tokens; a reconnect making a new row;
    Facebook keeping Pages without CREATE_CONTENT; the callback putting the
    platform's words in the address or the code in the logs; the state kept
    on a refusal; the removal keeping a LinkedIn profile; the cleanup
    skipping attempts; LinkedIn without its version header, a 422 taken as
    unclear, an upload sent anywhere, "(" unescaped; Facebook without
    appsecret_proof, code 1 taken as not created; X's 429 without its wait,
    a 503 taken as not created, client_id in the body; YouTube without
    offline access, a 503 upload taken as not created, a session address
    anywhere; a renewal without its token guard, renewing always, LinkedIn
    never running out, a refused renewal kept usable; the stand-in in
    production (connecting, publishing), production naming settings, half
    an app starting, no .dev-social/ warning, no time limit, redirects
    followed, the stand-in copying a file's bytes, the state stored as it
    is, X revoking the access token only, Connect shown to members; all
    undone. One (no time limit) was caught at first only by other checks:
    the time-limit check's fake never settled, so the run would have ended
    silently; it now has a timer of its own and fails directly.
  - By hand (scratch scripts, their data removed), headless Chrome through
    the real forms: against `next start` (production, 16 expectations:
    logged out the page answers 307 to /login?next=%2Fcofounder%2Faccounts
    and the callback 303 there, an unknown platform 404; the h1, Accounts
    marked in the row of links, every platform "Not set up by ansa yet"
    with no setting named and no Connect; the result messages as an alert
    and as a status, an odd one showing nothing; a made-up state landing
    on "expired"; 375 px wide; a member told only owners connect) and
    against `next dev` with a made-up X app (12: the stand-in's settings
    and access blocker named for ansa's operator; LinkedIn's stand-in
    connected, reconnected (still one) and disconnected after its question;
    "Connect X" sent the browser to x.com/i/oauth2/authorize with the
    client id, the redirect URI, S256 and a 43-character state and
    challenge (stopped there, never sent), the attempt saved under the
    state's hash, unused, PKCE encrypted, 600 seconds; the app secret in no
    address; 375 px; a member seeing the disconnected account and no
    button). Found by it: each platform said "Not set up by ansa yet" twice
    (badge and sentence; reworded). Also seen: a stale .next/dev cache made
    the development login page reload itself in a loop (not this step's
    code; deleting .next/dev fixed it).
- Decisions where the spec left room: CLAUDE.md's decisions log,
  2026-10-28 Step 40 (the renewal split between lib and services; a
  refused renewal = needs_reauth but a silent platform keeps the
  connection; two files per adapter; the extra identity scopes; Facebook's
  /me/permissions and appsecret_proof; LinkedIn's little text escaping; a
  stand-in post with url null; videos to YouTube only; a removed
  teammate's LinkedIn profiles disconnected; 303 redirects with fixed
  codes; local-only.ts refusing real apps).
- Left out, and why: LinkedIn, Facebook and X video uploads (each a
  multi-part upload with processing to poll; the spec's adapters list
  images only for them, and step 41 can refuse to schedule what
  PUBLISHED_FORMATS doesn't list); LinkedIn organization pages (need
  Community Management access); Facebook Pages past the first 100 (paging);
  a revoke for LinkedIn and Facebook (neither offers one with what ansa
  keeps); a service that publishes through a connection (the queue, step
  41, builds it on prepareConnectionForUse and publishPost).
- Review fixes, 2026-10-28 (11 findings, all real; two were one defect;
  migration 0036_social_renewal_claims; no new dependency or setting): a
  Disconnect has X or Google revoke only once no connection of that
  account anywhere still holds tokens (db/social-account-connected.ts, a
  yes/no read across companies: their grant is the account's with ansa's
  one app), from one list of the platforms that revoke
  (REVOKES_ON_REQUEST, lib/social-platforms.ts, also read by the
  Disconnect question); token renewals are claimed in one UPDATE
  (social_connections.renewal_started_at; over a minute old = a dead
  run's), and another run waits for the new tokens, so X is never sent a
  refresh token it just took; tokens are read under the stored id;
  Facebook needs all three permissions; the Accounts page's access
  lifetimes are worked out as of now in services/social-accounts.ts (a
  refresh token's own end; "ran out on" only for a date that passed), and
  its actions reopen it without the last result in the address; the
  privacy policy no longer claims who disconnected an account is kept;
  lib/social-settings.ts holds lib/env.ts's social settings (the
  ~200-line rule). 11 new checks (social-revoke-checks,
  social-renewal-checks, social-lifetime-checks, two in
  social-page-checks; social-connection-checks, social-rule-checks and
  social-refresh-checks extended, and the checks expecting a revoke now
  connect accounts of their own); typecheck, lint, 719 checks (0
  failures) and the build pass. Each of 16 planted bugs (one per fix, the
  file copied back after each run) made the check meant for it fail.

### Step 41: publishing queue, calendar, approvals, audit trail  `[x]`
- `publish_jobs` (claimed in one UPDATE, approved version recorded, one live job
  per draft and account), `autopublish_rules` (off), `cofounder_activity`
  (who did what: connect, approve, schedule, cancel, publish, fail).
- Worker: `/api/cron/publish` + right-away runs. Execution-time checks, token
  refresh, 429 backs off, unclear outcomes go to "needs attention".
- /cofounder/calendar (viewer's timezone) with "plan the next 2 weeks" (ideas
  only) and /cofounder/queue (status, errors, cancel, retry, publish now).
- Done 2026-10-28 (migrations 0037_publishing_queue and
  0038_publish_claim_ids; no new dependency or setting: CRON_SECRET is
  reused for /api/cron/publish). Real platforms stay BLOCKED with step 40
  (decision 7): every post went through the development stand-in or a fake
  platform. Built: db/schema/publishing.ts (publish_jobs, autopublish_rules)
  and db/schema/cofounder-activity.ts; db/publish-scheduling.ts and
  db/publish-schedule-context.ts (scheduling and Retry, one transaction
  each), db/publish-runs.ts (the claims, each with its own claim_id, the
  check right before sending, the stale sweep), db/publish-run-read.ts (a
  run's one snapshot), db/publish-outcomes.ts, db/publish-job-actions.ts
  (Cancel, Publish now, Mark as published / not published),
  db/publish-draft-sync.ts (a draft's status from its posts; a change
  cancels its waiting posts), db/publish-jobs.ts (the lists),
  db/autopublish-rules.ts, db/cofounder-activity.ts, db/content-calendar.ts;
  lib/publishing/ (kinds, limits, activity actions and their words, job
  error codes and their words, the run-time and scheduling checks, a
  draft's status, a 429's wait, post addresses, times in a timezone),
  lib/calendar-plan/ (prompt, JSON schema, answer), lib/validation/
  publishing.ts, lib/cron-secret.ts; services/publish-scheduling.ts,
  publish-attempt.ts, publish-runs.ts, publish-cron.ts,
  publish-job-actions.ts, publish-messages.ts, autopublish-rules.ts,
  calendar-planning.ts, publishing-pages.ts, draft-publishing.ts;
  askClaudeForCalendarPlan (adapters/claude.ts, its settings with the
  others in adapters/claude-settings.ts); app/actions/publishing.ts; GET
  /api/cron/publish (maxDuration 300); /cofounder/queue and
  /cofounder/calendar (after Studio in the Co-Founder's row of links),
  app/cofounder/publishing/ (posts, their buttons, the activity list) and
  a draft's Publish section (schedule-form.tsx, draft-publishing.tsx).
  Changed: an edit, a new AI text, a change of a draft's image, video or
  alt text, a rejection and an archive cancel its waiting posts;
  approvals, rejections, archives, restores, connections, disconnections,
  reconnect-needed marks and new plans write the activity log; the daily
  job sends due posts after its cleanup and stuck work (review fixes:
  before them, below); another owner can
  approve again a version approved by someone made a member or removed
  (db/content-draft-status.ts and the draft's page). CLAUDE.md,
  docs/going-live.md (sections 8 and 10, errors, monitoring), the privacy
  policy and the terms say what it does. typecheck, lint, 766 checks (0
  failures, 47 new) and the build pass (every /api route ƒ,
  /api/cron/publish too); the drift check finds no schema changes.
  Evidence, by check file:
  - publishing-run-checks: "publishing: an approved draft scheduled for
    now goes out right after the answer: the stand-in writes it to
    .dev-social/<platform>/, the post is published with its dev id, the
    draft is published, and the log says scheduled, then published",
    "publishing: drafts that aren't approved are refused when scheduled;
    one changed, rejected or archived after its post was claimed fails it
    when it runs (draft_changed, draft_rejected, draft_archived) and
    nothing is sent", "publishing: an approver made a member, or removed,
    after the post was scheduled: it fails when it runs
    (approver_not_owner) and nothing is sent; the draft can't be scheduled
    again until another owner approves it, which the draft's page then
    offers, and its post goes out", "publishing: a word to avoid confirmed
    after the approval stops the post: scheduling the draft is refused,
    and its post already waiting fails when it runs (draft_has_problems);
    nothing is sent", "publishing: a post scheduled under an auto-publish
    rule fails when it runs once the rule is switched off (rule_disabled),
    nothing sent; with the rule on it goes out".
  - publishing-claim-checks: "publishing: five runners at the same moment
    claim a due post once: one request to the platform, one published
    post, one try", "publishing: one claim takes exactly one due post, the
    longest waiting, even with several due (the others stay queued for the
    next claim)", "publishing: a post still 'publishing' 10+ minutes after
    its claim was cut off while sending: it goes to a person (needs
    attention, 'interrupted') and is never sent again; one claimed a moment
    ago is left alone", "publishing: a run that lost its post never writes
    over what came after: once its claim was handed to a person, and again
    once the post was tried again (its tries counted from 1 again) and
    claimed anew, its published, failed, needs-attention and
    back-in-the-queue writes change nothing, and it can't read the post to
    send it", "publishing: the platform is asked only while the run's claim
    is young enough for its longest answer to come before the claim counts
    as cut off; a run held up past that sends nothing and puts the post
    back in the queue (run_too_slow, its try given back), and the next run
    sends it".
  - publishing-outcome-checks: "publishing: a platform's 429 puts the post
    back in the queue for the wait it asked (or 1, 2, 4 minutes), each run
    a try, and the fifth 429 fails it (rate_limited)", "publishing: an
    unclear answer (a 500, no answer) needs a person and is never tried
    again by itself; 'Mark as published' keeps only an address on the
    platform's own hosts, 'Mark as not published' fails it, and Retry then
    sends it", "publishing: an X token about to run out is renewed before
    the post (the new token sent); a refused renewal marks the account for
    reconnecting and fails the post (reauthorization_needed); LinkedIn
    refusing the token (401) does the same (token_rejected)", "publishing:
    posts survive a restart (rows only): with the run after the answer
    lost, a fresh runner sends the due ones, the longest waiting first, and
    leaves one not due yet", "publishing: past the company's posts for the
    day a post is held back (queued, daily_limit, its tries untouched,
    tried an hour later) and the platform isn't asked; another company
    still posts", "publishing: production refuses a stand-in account's
    post (stand_in_in_production), and a platform ansa hasn't set up
    publishes nothing (not_set_up)".
  - publishing-schedule-checks: "publishing: scheduling needs an owner (a
    member is refused by the service and by /db), the version the page
    showed, and connected accounts of the draft's own platform; a time
    over a minute ago or over a year ahead is refused; a refusal saves
    nothing", "publishing: the same post can't be queued twice for one
    account: a second schedule is refused, Postgres refuses a second live
    post (also two schedules at once: one wins), and a canceled or failed
    one leaves room for a new one", "publishing: Postgres refuses a post
    pointing at another company's draft, account or person; another
    company's owner can't schedule, cancel, send, retry or mark the
    company's posts (services and /db) and finds none of them; an owner
    can't send a draft to another company's account", "publishing:
    editing, regenerating or attaching media to a scheduled draft cancels
    its waiting posts in the same transaction
    (draft_changed_after_approval, then canceled with draft_changed); a
    post being sent at that moment is left alone", "publishing: Cancel
    takes a waiting post out (owners only; one that went out can't be);
    Publish now sends a waiting post at once; Retry checks like a new
    schedule (a draft changed since needs approving again, then its new
    version is sent)".
  - publishing-rule-checks: "auto-publish rules: made switched off by
    owners only (a member is refused, services and /db); switching one on
    or off is an owner's, recorded with who and when; one rule per
    platform and pillar; a pillar must be the current plan's",
    "auto-publish rules: without an approval a draft is scheduled only with
    the owner's tick and an enabled rule covering its platform and pillar,
    when it breaks no rule and every claim is backed; a claim to check, a
    hand edit, a rejected or archived draft never go", "auto-publish
    rules: a rule's post fails when it runs once the owner who switched the
    rule on is no longer an owner (rule_owner_gone), or a confirmed fact
    behind its claim changed (claims_not_checked); nothing is sent, and the
    rule schedules nothing more while that owner is gone", "auto-publish
    rules: nothing turns a rule on by itself: a new rule is saved switched
    off, and the only write that sets enabled is an owner's switch
    (db/autopublish-rules.ts); no migration turns one on".
  - publishing-time-checks: "schedule times: a date and time typed in a
    timezone other than UTC is stored as the right UTC instant (Lisbon,
    Kolkata, New York, Kiritimati); a skipped hour moves past the jump, a
    repeated one takes the first; odd dates, times and timezones give
    nothing", "schedule times: the schedule form sends the UTC instant
    wallClockToUtc made from the date, the time and the browser's own
    timezone, in its onSubmit; the server takes a time at most a minute
    ago and at most a year ahead", "publishing: a draft's status follows
    its posts (scheduled while one is on its way, failed while one failed
    or needs a check, published once all went out; with none left,
    approved while its approval holds, else a draft), and a 429's wait is
    the platform's (30 s to a day) or 1, 2, 4, 8 minutes", "publishing: a
    post's address is kept only as https on its own platform's hosts,
    without a user name, a password or a port", "publishing: every code a
    post can fail, wait or need attention with (the queue's own and the
    platforms') reads as a sentence of its own, never as the code".
  - publishing-cron-checks: "publish route: off without a CRON_SECRET
    (404), refused with a wrong or missing one (401, one fixed log line,
    nothing run), runs the queue with it and says what came of it, never
    cached; past its hourly calls from one address, 429", "publish route:
    a thin GET that reads the request first (await connection()), so it
    runs on every request (ƒ in the build), with maxDuration 300;
    vercel.json keeps only the daily job (Vercel Hobby allows daily crons
    only)", "daily job: after its cleanup and stuck work it sends due posts
    with what is left, on the same clock (counted from the start of the
    job), and says so" (review fixes: posts first, below), "publish runs: a post is started only while its
    longest run (getting the account ready, reading its media, YouTube's
    upload, the database) still fits in the 300 seconds; one not started
    stays queued and due".
  - publishing-activity-checks: "activity: connecting and disconnecting an
    account, a teammate's removal disconnecting their profile, approving,
    rejecting, archiving, restoring and a new plan each write their row
    with who did it", "activity: a change that doesn't happen writes
    nothing: a refused schedule, a second schedule refused by the database
    (its transaction rolled back), an approval of a draft approved
    already", "activity: the queue page lists the company's newest entries
    in plain words and a draft's page its own; another company's never
    show; no column holds a token or a post's text, and a run's log lines
    hold neither".
  - publishing-page-checks: "calendar and queue pages: in the Co-Founder's
    row of links after Studio, each with its h1, bringing logged-out
    people back to itself, allowed 300 seconds (posts go out, and the AI
    plans, after their answers)", "publishing pages: their buttons show to
    owners only (the services and /db refuse members anyway); canceling,
    marking, a risky retry and switching a rule on ask first; the schedule
    form and the AI plan send from onSubmit", "queue page: the company's
    posts by status with their counts, the rules and the current plan's
    pillars; members read it without buttons; another company's posts
    never show", "calendar page: the company's posts (never a canceled
    one) and its planned drafts and ideas of the next weeks, by time; not
    another company's, not a draft planned outside the weeks".
  - calendar-plan-checks: "calendar plan: without a current marketing plan
    it says so and asks nobody; a member is refused (the service and /db);
    a browser that names no timezone is refused; past its plans for the
    hour the company is refused before Claude is asked", "calendar plan:
    the AI's ideas become drafts in status idea with only a topic,
    platform, format, pillar and campaign, planned for their day and time
    in the owner's own timezone; nothing written, approved or scheduled;
    each in the activity log", "calendar plan: the answer is kept to what
    was asked, post by post: a day not planned, a platform without a
    target, an empty topic and a repeat (also of one planned already)
    drop; an odd time is 09:00; a format the platform doesn't take is its
    first; a name not in the plan is none; never more than a platform's
    target; a field we didn't ask for makes it unusable", "calendar plan:
    Claude gets only the plan's pillars, campaigns and cadence, the days
    and the topics planned then, each escaped (card numbers hidden); no
    fact, account or id; the schema sent and our own check agree".
  - claude-adapter-calendar-checks: "Claude adapter: a calendar plan sends
    its own settings: effort medium, 6,000 tokens, 90 seconds a try and
    one retry, less room than a content draft", "Claude adapter: a
    calendar plan fits the calendar page's 300 seconds: a 500 is tried
    twice, and a plan that never comes is cut off at its longest run".
  - Extended: claude-adapter-checks (a calendar plan without a key asks
    nobody), the 300-second checks of the Claude adapters and stuck work
    (the publish route, the calendar and queue pages), ops-checks,
    ops-maintenance-checks and stuck-work-checks (the daily job's
    publishing step), content-studio-page-checks (the new statuses'
    counts); the sub-navigation, page-heading and login-redirect checks
    cover the two new pages; cleanup.ts removes the new rows first.
  - Each of 59 deliberate bugs was planted alone (a scratch script writing
    the file back after each run and comparing its bytes) and made the
    check meant for it fail: the claim by id without its "queued" guard,
    or of another company's post; the next due claim with an IN subquery,
    or ignoring run_after; stale claims never found, or queued again; a
    run's writes held without its claim_id or without "publishing"; a
    claim too old still sending, or no check before the platform; the
    run-time check ignoring a version change, the approver's role, a rule
    switched off, the rule's owners or unbacked claims; scheduling without
    an approval, at a past time, by a member in /db, to another company's
    account, with an approver who left, under a rule whose owner left,
    with unbacked claims under a rule, or breaking a rule; the timezone
    offset the wrong way, a repeated hour taking the second; an edit
    leaving waiting posts queued, or canceling one being sent; a 429
    never stopping or waiting nothing; an unclear answer tried again; a
    refused renewal tried again; a refused token not marking the account;
    no daily limit, or one taking a try; the publish route taking any
    secret, running without CRON_SECRET or without connection(); the
    runner ignoring its time budget; the daily job's posts on a clock of
    their own; the activity list, the queue and the calendar of every
    company; ideas saved as drafts; a platform's target ignored; /db
    planning the calendar for a member; a new rule switched on, or
    switched by a member in /db; Retry without the schedule check; a post
    address on any host; Mark as published from any status; Cancel of a
    post that went out; a draft published while a post is being sent;
    approving an approved draft writing a row; an approval by someone who
    left blocking a new one, or trusted by the draft's page; the calendar
    prompt unescaped; post buttons for members; the schedule form sending
    the typed time as UTC; a stop code without its words. All undone. Six
    were at first caught by no check (scheduling reading any company's
    accounts: Postgres refused the post, as an error; the daily job's
    clock, its fake cleanup taking no time; /db planning for a member;
    scheduling under a rule whose owner left; scheduling with an approver
    who left; scheduling a draft that breaks a rule): their checks now
    catch them.
  - Found while writing those checks, and fixed: the attempt number alone
    told a run's claim apart, and Retry counts tries from 1 again, so a
    run whose claim was handed to a person could still read the post,
    send it again and write over the next run's outcome (a check written
    for it failed): each claim now gets its own claim_id (migration
    0038), and the platform is asked only while the claim is younger than
    10 minutes minus the platform's longest answer, so the 10-minute
    handover never meets a post still going out (otherwise nothing is
    sent and the post goes back in the queue, run_too_slow). And the
    refusal "an owner approves it again" led nowhere: Approve answered
    "approved already" for an approval by someone made a member or
    removed; another owner now approves it again, and the draft's page
    says so and offers it. The schedule form's time error is now tied to
    its fields (aria-describedby).
  - By hand (scratch scripts, their data removed), headless Chrome through
    the real forms against `next dev` (the stand-in, and a local stand-in
    for Anthropic's API), 34 expectations: a draft's Publish section with
    the stand-in account; "Publish version 1 now" went out (no address,
    "written to the development stand-in's folder"), one file in
    .dev-social/linkedin/ with the post's text, the draft Published and
    read-only, its activity naming who scheduled it; "At a date and time"
    offering tomorrow at 09:00 in the viewer's named timezone, 10:45 local
    shown, the draft Scheduled; the queue's sections and counts, Queue
    marked, Cancel asking first and recording the owner, a rule made Off
    and switched on after the WITHOUT-an-approval question, both in the
    activity; the calendar from today, the canceled post absent, "Plan the
    next 2 weeks" adding 4 ideas on their days and times; a draft approved
    by an owner since made a member: the summary and the Publish section
    say so, Approve is offered, and after it the form is back; a member
    seeing the queue without buttons, "Only owners schedule posts." and no
    AI planning; 375 px wide without sideways scrolling; no browser
    errors. The fake's log shows the calendar request held the targets,
    the days and the plan's pillars and campaigns only (no fact, name or
    address). Found by it: the schedule form stayed when every account
    already had the post (now a sentence), and a published draft's
    approval note said a change would make it a draft (now "It went out
    as that version."). Against `next start` (the production build, a
    throwaway CRON_SECRET): /api/cron/publish answered 401 without a secret
    and with a wrong one (one "Publish run rejected: invalid secret" line
    each) and 200 with it (the counts, no-store); /cofounder/queue and
    /cofounder/calendar sent a logged-out visitor to
    /login?next=%2Fcofounder%2Fqueue (and calendar) with a 307.
- Decisions where the spec left room: CLAUDE.md's decisions log,
  2026-10-28 Step 41 (permission decided when a post runs, on one
  snapshot; a draft's status follows its posts only while the queue has
  it, "failed" covering needs attention; scheduled and failed drafts stay
  editable, rejectable and archivable, each canceling waiting posts, a
  published one final; more accounts while scheduled or published; Retry
  checked like a new schedule, publishing the current approved version;
  a stale claim always needs attention; rules made off, their maker and
  switcher both active owners, an explicit tick, no blocking issue and no
  claim to check; a scalar SKIP LOCKED subquery; a claim_id per claim and
  the time left before sending; approving again after an approver left;
  the limits; times sent as one UTC instant; the calendar plan reading
  the plan only; claude-settings.ts).
- Left out, and why: the platforms' own scheduling (ansa's queue sends
  each post when due, so the run-time check covers every post); every
  minute on Vercel Hobby (daily crons only: /api/cron/publish needs Vercel
  Pro or an outside pinger, docs/going-live.md section 8); a month grid
  (a list by day, readable on a phone, as the spec allows); moving a
  planned idea to another day (the AI plans the day; an owner schedules
  from the draft's page); video posts to LinkedIn, Facebook and X (step
  40 left them out: scheduling refuses what PUBLISHED_FORMATS doesn't
  list); retrying an unclear outcome by itself (never: decision 8);
  turning a rule on for a real account (nothing does).
- Review fixes, 2026-10-28 (8 findings, all real; no migration, new
  dependency or setting): the runners let the companies take turns (one
  due post each per round, the longest waiting first; a company whose
  post its daily limit held back gets no more turns in that run), and the
  limit is counted before the account is made ready (no renewal or media
  read for a post held back): posts past one company's 30 a day came back
  every hour and could take every post a run may start from the others.
  The daily job sends due posts first (a run starts one only in its first
  ~30 s, which the cleanup or one stuck call used up), and a run stopping
  with posts due logs "Publish run stopped at its time limit / batch
  size". Both cron routes check the secret before the per-IP count, so
  strangers on a pinger's shared addresses can't use up the scheduler's
  calls. Making an owner a member disconnects their LinkedIn profiles
  (db/team-members.ts, as removal does; the Team page's question says
  so). A failed post scheduled again on its account no longer keeps a
  published draft "failed" and editable, and offers no Retry (it never
  worked: scheduledAgain, db/publish-jobs.ts); an approval leaves a draft
  the queue has in the queue's status, so marking a rule's post published
  publishes its draft. A post cut off while sending is listed and counted
  as needing attention at once (db/publish-jobs.ts computes it: Next.js
  forbids writes while rendering), and a person's Mark or Retry hands it
  over first (handOverCutOffJobWithin). Each post's buttons name it for
  screen readers ("Publish now: “<topic>” on LinkedIn (Ana Baker)").
  db/content-calendar.ts took the calendar's planned-drafts read (the
  ~200-line rule). 6 new checks (publishing-turns-checks; one each
  in publishing-cron-checks, publishing-rule-checks, publishing-page-checks
  and social-rule-checks) and 7 extended (the publish route, the daily
  job's order, the time budget's log line, the approver made a member,
  the draft's status from its posts, the post buttons, the daily limit);
  typecheck, lint, 772 checks (0 failures) and the build pass (every
  /api route ƒ); the drift check finds no schema changes. Each of 17
  planted bugs (one at a time, the file copied back after each run and
  compared byte for byte) made the check meant for it fail: no turns, a
  held-back company keeping its turns, the limit counted after the
  account was made ready, either route counting before the secret, a
  demotion leaving the profile connected, a replaced failure still
  counting, the list not flagging it, Retry offered on it, posts after
  the cleanup and stuck work, a run out of time saying nothing, an
  approval making a failed draft approved, a cut-off post shown as going
  out, Mark and Retry not handing it over, its count under publishing,
  and two buttons without their post's name.

## Stage 6: analytics

### Step 42: analytics + evidence-based recommendations  `[x]`
- `post_metrics` snapshots, collected daily from each platform where it offers
  them; a metric a platform doesn't give is shown as "not available", never 0.
- /cofounder/analytics: periods, definitions per platform, failures.
- Recommendations from Claude only with enough data, each citing the numbers
  it is based on (checked against what it was given).
- Done 2026-10-28 (migration 0039_post_metrics; no new dependency or
  setting). `[b]` Reading real platforms' numbers stays BLOCKED with step 40
  (no developer apps, decision 7): every number in the checks came from a
  fake platform, and in development they come only from `pnpm
  simulate:post-metrics` (decision 6). Built: db/schema/post-metrics.ts
  (post_metrics), db/schema/performance-reviews.ts (performance_reviews),
  publish_jobs.metrics_attempted_at / metrics_error and
  marketing_plans.performance_review_id; lib/metric-definitions.ts (per
  platform and number: read from a field, needing a permission ansa doesn't
  ask for, or not offered, with a line each), lib/metrics-errors.ts,
  lib/social-metrics.ts, fetchPostMetrics in lib/social-publishing.ts and
  each adapter (adapters/x-metrics.ts, facebook-metrics.ts,
  youtube-metrics.ts; LinkedIn and the stand-in ask nothing),
  lib/analytics/ (kinds, periods, totals, format), lib/performance-review/
  (limits, readiness, review-input, review-prompt, review-json-schema,
  review-answer, text-numbers, stored-review, past-performance),
  lib/validation/analytics.ts and ?period= in lib/validation/list-queries.ts;
  db/post-metrics.ts (the claims and the outcomes), db/post-metrics-reads.ts
  (the page's reads), db/post-metrics-simulation.ts,
  db/performance-reviews.ts, getPublishingProblemsBetween in
  db/publish-jobs.ts; services/post-metrics-collection.ts,
  post-metrics-simulation.ts, analytics-page.ts, performance-review.ts;
  askClaudeForPerformanceReview (PERFORMANCE_REVIEW_SETTINGS);
  app/actions/analytics.ts; /cofounder/analytics (app/cofounder/analytics/:
  the page, its periods, collection status, totals, post table, review and
  its form, definitions) after Queue in the Co-Founder's row of links;
  scripts/simulate-post-metrics.ts (`pnpm simulate:post-metrics`). Changed:
  the daily job reads post numbers last, /api/cron/publish after its posts;
  the marketing planner reads the newest review as <past_performance> and
  the Strategy page names it under "What this plan was made from"; the
  Accounts page says which of a platform's numbers Analytics reads
  (lib/social-platforms.ts); the research gained section 5 (each platform's post numbers, checked
  2026-10-28). CLAUDE.md, docs/going-live.md (section 10, errors,
  monitoring), the README and the privacy policy say what it reads, keeps
  and sends. typecheck, lint, 799 checks (0 failures, 27 new) and the build
  pass (every /api route ƒ); the drift check finds no schema changes.
  Evidence, by check file:
  - metrics-definition-checks: "metric definitions: every platform defines
    all seven numbers; each it gives has its label, its field and a
    one-line definition, each it gives only with a permission names it,
    each it doesn't have says why; LinkedIn fills none
    (r_member_postAnalytics), so only Facebook, X and YouTube are read",
    "post numbers: the database's CHECKs list exactly the code's sources; a
    job's metrics error is a code, never a message, and only on a post that
    went out" (review fixes: a queued post's try refused too), "post
    numbers: Postgres refuses a snapshot of another company's post, a
    negative count, a snapshot without a single number and an unknown
    source; a review by a person of another company, and a plan pointing
    at another company's review".
  - metrics-adapter-checks: "x numbers: GET /2/tweets/<id> with
    tweet.fields public_metrics and non_public_metrics while the post is
    under 29 days old (public_metrics alone after), the account's token, a
    time limit, no redirect; impressions, likes, replies, reposts + quotes
    and link clicks; a 0 stays 0, a field X leaves out is null", "x
    numbers: 401 is token_rejected, 403 permission_denied, 404 not_found,
    429 rate_limited, 503 server_error, no answer a timeout or network
    error; a 200 holding only X's resource-not-found problem is not_found
    too, any other 200 without a post holds no numbers, a negative or
    non-whole count makes the answer unreadable, and an odd id asks
    nothing" (review fixes: resource-not-found),
    "facebook numbers: one GET of the post with fields shares,
    reactions.limit(0).summary(total_count) and
    comments.limit(0).summary(true), the Page's token and its
    appsecret_proof; reactions and comments from their totals, shares from
    shares.count (left out: null, never 0); views, viewers and clicks are
    never asked (they need read_insights)", "youtube numbers: videos.list
    with part=statistics for the video's id and the channel's token;
    viewCount, likeCount and commentCount (strings of digits) as views,
    likes and comments; a count YouTube hides is null; an unknown video
    (404, or no items) is not_found; quotaExceeded is quota_exceeded; a
    count past Postgres's integer makes the answer unreadable", "linkedin
    numbers: LinkedIn is never asked (its member post numbers need
    r_member_postAnalytics, a Community Management permission ansa's app
    can't ask for), so none is read; its definitions say so".
  - metrics-collection-checks: "metrics collection: a post of the last 30
    days is read once it has been out an hour, its snapshot saving what X
    gave (what X left out stays null), and isn't asked again for 20 hours;
    the post's place in the queue (updated_at) doesn't move", "metrics
    collection: never a development stand-in's post (its numbers are
    simulated only), one marked published by hand (no id on the platform),
    one out for under an hour, one out for over 30 days, nor another
    company's", "metrics collection: an account needing a reconnect is
    skipped with its reason (reauthorization_needed, nothing asked); a
    platform's refusal or silence records its code on the post and makes no
    snapshot; X refusing the token marks the account as needing a
    reconnect, in the activity log too", "metrics collection: two runs at
    the same moment read a post once (one request, one snapshot): each
    claims it in one UPDATE first", "metrics collection: a post is started
    only while its longest read (the account made ready, the platform's
    answer, the database) fits in the 300 seconds, at most a batch a run,
    and a run stopping with posts left says so in one fixed line", "publish
    route: after its due posts it reads a few posts' numbers (10 a call;
    the daily job 100, after its other work), on the same clock, and says
    what came of both".
  - metrics-read-window-checks (review fixes): "metrics collection: an X
    post is read for 28 days only, so its newest snapshot keeps the link
    clicks X gives under 29 days (a read after would have none and hide
    them on the page and in reviews); a Facebook post as old is still read
    (30 days)", "analytics page: a post past its platform's read days
    without numbers says none were read in those days, never 'Not read
    yet' (which a newer one still says); under older numbers, its failed
    last try no longer promises another; the table says what these words
    say".
  - metrics-simulation-checks: "simulate:post-metrics: saves a
    dev_simulated snapshot of a stand-in's published post (the numbers
    given, the rest null), which the Analytics page shows as simulated; a
    real account's post is refused (its numbers come from its platform
    only), and so is one that didn't go out", "simulate:post-metrics:
    refuses a number the post's platform doesn't have (X's reach,
    LinkedIn's video views), an unknown or repeated number, a negative,
    decimal or too large one, no number, an id that isn't one or no post's,
    and production; nothing is saved", "simulate:post-metrics: the command
    refuses to run outside a local database or with an outside service on
    (the checks' own guard), takes the job id and name=value numbers, and
    is a package script".
  - analytics-page-checks: "analytics page: in the Co-Founder's row of
    links after Queue, with its h1, bringing logged-out people back to
    itself, allowed 300 seconds (the review asks Claude in its action); the
    review form sends from onSubmit with the browser's timezone; its
    problems list has no buttons", "analytics page: the period's posts
    newest first, each with its newest snapshot; totals per platform add
    only the numbers posts have (a post without one adds nothing, not 0),
    say 'not available' where the platform has no such number and why
    where ansa doesn't read it; ?period= is 7, 30 or 90, anything else 30",
    "analytics page: another company's posts, numbers, problems and reviews
    never show; the period's publishing problems do, the last simulated
    collection is named, and a member reads it all without the review
    button".
  - performance-review-checks: "performance review: no model call below 5
    posts with numbers in the period (the refusal and the page say how many
    more), for a member (the service and /db), past the company's reviews
    for the hour, or without the browser's timezone", "performance review:
    Claude gets aggregates only: per post a label, platform, format,
    pillar, topic (escaped, card numbers hidden), weekday and hour in the
    owner's timezone and its numbers (a missing one left out, not 0); per
    platform and pillar the totals; never an account, a person, an id, a
    post's text or another company's posts; the schema sent and our check
    agree".
  - performance-review-answer-checks: "performance review: a finding citing
    a wrong value, a post that doesn't exist, a number under another name,
    both a post and a group, or writing a number it doesn't cite (in any
    script's digits) is dropped whole, as is one citing nothing;
    recommendations keep only kept findings, renumbered, writing only
    their numbers or a time; a limit writing a number the data doesn't
    hold drops; the rest is saved with exactly the numbers sent" (review
    fixes: any script's digits), "performance review: when every finding is
    dropped nothing is saved and the page says the review failed; an answer
    of another shape, no AI, or a failed request save nothing either and
    say so (a failure logs its class only)", "performance review: the
    newest review shows on the Analytics page, each cited number in words,
    and goes to the next marketing plan as past performance (only its
    checked findings and numbers, escaped), the plan recording which review
    it read; another company sees neither and its plans read none".
  - performance-review-text-checks (review fixes): "performance review:
    the numbers a text writes are found in any script's digits (full-width
    ones read as 0-9), so writing ۴۰٪ or ４０% uncited fails; a cited value
    counts only in 0-9 (the prompt asks for them), digits quoted from a
    cited topic as written", "performance review: the next marketing plan
    gets each cited post's topic and pillar as the review's own request
    held them (card-like and social-security-like numbers hidden, cut to
    200 characters); the Analytics page still shows the company the whole
    topic".
  - claude-adapter-review-checks: "Claude adapter: a performance review
    sends its own settings: effort medium, 8,000 tokens, 120 seconds a try
    and one retry", "Claude adapter: a performance review fits the
    Analytics page's 300 seconds: a 500 is tried twice, and a review that
    never comes is cut off at its longest run".
  - Extended: publishing-cron-checks (the daily job's order: posts,
    cleanup, stuck work, numbers, one clock; the publish route's answer
    holds the numbers' counts), claude-adapter-checks (a review without a
    key asks nobody), social-stand-in-checks (the stand-in never makes
    numbers up; a platform not set up reads none), stuck-work-checks (the
    Analytics page may run 300 seconds), marketing-plan-checks and
    marketing-plan-schema-checks (a plan's review id), ops-checks and
    ops-maintenance-checks (a fake numbers run, so no check reads every
    company's posts); the sub-navigation, page-heading and login-redirect
    checks cover the new page; cleanup.ts removes the new rows.
  - Each of 41 deliberate bugs was planted alone (a scratch script writing
    the file back after each run, every file's checksum compared after) and
    made the check meant for it fail: a stand-in's post, one younger than
    an hour, older than 30 days, without a platform id, or tried in the
    last 20 hours collected; the snapshot or failure write without its
    company; the claim moving updated_at; needs_reauth recorded under
    another code; a failure saved as a snapshot of zeros; a refused token
    not marking the account; no time budget; no batch size; X's private
    numbers always asked, its shares from reposts alone; Facebook's missing
    shares as 0, no appsecret_proof; YouTube's unknown video as no
    numbers; LinkedIn answering failed; the stand-in reaching the adapter;
    a missing number counted as 0 in a total; the page's posts and
    problems of every company; the oldest snapshot shown; simulating a real
    account's post, a number the platform lacks, or in production; a
    review with 4 posts, without the hourly limit, or saved by a member in
    /db; evidence values not compared; numbers in a finding's text not
    checked; recommendations not renumbered; the hour in UTC; the topic
    unescaped; the planner without the review, or with another company's;
    the plan not recording its review; the daily job or the publish route
    reading no numbers; the review's settings changed. All undone.
  - By hand (scratch scripts, their data removed), headless Chrome against
    `next dev` with a company of 11 stand-in posts (9 with simulated
    numbers), a failed X post and a saved review: the page at 1280 and 375
    px (no sideways scrolling, no browser error), its totals per platform
    ("Not available on X" for reach, "Not read yet (needs a permission)"
    for LinkedIn's reach and link clicks, "No numbers yet" for Facebook's
    shares), each post's numbers or why none with its simulate command,
    the failed post under Publishing problems without buttons, the review
    with each cited number named ("P6: “Our sourdough story, part 6”,
    LinkedIn text post, Wednesday 03:00: Reactions 9"); "Review performance
    again" answering without an API key "The AI isn't available right now,
    so no review was made."; a member reading it with "Only owners ask for
    a review."; a company without posts "No published posts in this period
    (last 7 days)" and "it has 0: 5 more are needed"; logged out, a 307 to
    /login?next=%2Fcofounder%2Fanalytics%3Fperiod%3D7. Found by it: on a
    phone the "Simulated (development)" badge (it never wraps) pushed the
    numbers column past the screen (now plain text), and the review's
    findings named posts by labels the page didn't explain (each cited
    number now names its label).
- Decisions where the spec left room: CLAUDE.md's decisions log,
  2026-10-28 Step 42 (the permissions step 40 asks for are kept, so only
  what they allow is read: LinkedIn nothing, Facebook reactions, comments
  and shares, YouTube the Data API's live statistics rather than the
  Analytics API's late views, X its public and, under 29 days, private
  numbers; "older than about a day" counted from the latest try (20
  hours); the first read an hour after a post went out; a try claimed in
  one UPDATE; the publish route reads 10 a call, the daily job 100; a
  refused token marks the account; a simulated snapshot may hold any number
  the platform has; the review's groups, labels and averages; numbers in a
  finding's text checked too; limits_of_this_data a list; the newest
  review goes to the planner whatever its age, recorded on the plan).
- Left out, and why: asking for more permissions (Facebook's
  read_insights, YouTube's yt-analytics.readonly, LinkedIn's
  r_member_postAnalytics): each is a new App Review or verification and a
  decision for you; the spec keeps a number behind a permission ansa
  doesn't ask for null, and lib/metric-definitions.ts names each one.
  Numbers per day (a chart of a post over time): the page shows each
  post's newest snapshot, as the spec asks, and every snapshot is kept for
  later. Reviews older than the newest are kept but not listed (only the
  newest is shown and used).
- Review fixes, 2026-10-28 (8 findings, all real; two were one defect; no
  migration, new dependency or setting): the marketing planner got each
  cited post's topic and pillar whole from the stored review, card-like
  and social-security-like numbers included, where the review's own
  request had hidden them and cut topics to 200 characters
  (lib/performance-review/past-performance.ts now sends them as that
  request did; redactedAndCut in lib/cofounder/prompt-text.ts). X's posts
  are read for 28 days (metricsReadDays, lib/metric-definitions.ts; the
  claim keeps its overall 30-day bound for the index): a read in a post's
  29th or 30th day asked X for public numbers only, and that newest
  snapshot hid every link click read before, on the page and in reviews.
  A review's number check reads any script's digits after NFKC (\d is 0-9
  only, so ۴۰٪ or ４０% passed as no number) and the prompt asks for 0-9.
  The Analytics page says a post past its platform's read days had none
  read in them (it said "Not read yet") and drops a failed last try's
  "ansa tries again tomorrow" then (lib/analytics/post-notes.ts, the
  service's numbersStillRead). X's 200 naming resource-not-found is
  not_found, like its 404 (the research's section 5 now quotes X's
  docs). A check now proves publish_jobs_metrics_only_when_published, and
  CLAUDE.md's step 37 rules name <past_performance>,
  performance_review_id and what is hidden in it. 4 new checks
  (metrics-read-window-checks, performance-review-text-checks) and 4
  extended (X's not found, numbers in other digits dropped through the
  service twice, a queued post's metrics try refused); typecheck, lint,
  803 checks (0 failures) and the build pass (every /api route ƒ); the
  drift check finds no schema changes. Each new check was first run
  against the code before the fixes (6 failed; the constraint's passed,
  the constraint being there), and each of 13 planted bugs (one at a
  time, the file copied back after each run and compared byte for byte;
  the constraint dropped and put back as migration 0039 writes it) made
  the check meant for it fail: the planner reading the stored topics
  whole, numbers matched in 0-9 only, no NFKC, the prompt not asking for
  0-9, every platform's posts read for 30 days, X's for 29, X like the
  rest, no words for a post past its days, the failed last try still
  shown then, the page saying every post is still read, the table
  keeping its own last-try line, X's not found as no numbers, and no
  publish_jobs_metrics_only_when_published.

## Stage 7: one product

### Step 43: unified overview, navigation, final verification  `[x]`
- Header: Tickets, Calls, Emails, Knowledge, Co-Founder, Team, Setup; the
  Co-Founder section has its own sub-navigation.
- Dashboard "Business overview" with real numbers from both modules.
- docs/going-live.md, README, CLAUDE.md brought up to date; a final full run of
  every check and the build; an end-to-end walk through the services.
- Done 2026-10-28 (no migration, new dependency or setting). What needs an
  outside account stays BLOCKED where steps 35, 39 (the image service), 40,
  41 and 42 left it; the acceptance checklist below names each item and
  its exact requirement. Built: the dashboard's "Business overview"
  (lib/business-overview.ts, db/business-overview.ts,
  db/cofounder-progress.ts, services/business-overview.ts,
  app/dashboard/business-overview.tsx: the dashboard's h1, with the ticket
  list an h2 below it); the Co-Founder Overview's "Getting started"
  checklist (lib/cofounder/getting-started.ts, services/cofounder-overview.ts,
  app/cofounder/getting-started.tsx); connectionStatusAsOfNow in
  services/social-accounts.ts (the Accounts page's own rule, now shared by
  both); the Co-Founder's row of links in the spec's order
  (lib/cofounder/pages.ts: Media after Studio). The header already had the
  spec's order; it is now a check. The consistency pass changed no page:
  each rule it names is now a check (below), and every one held. The daily
  job already deleted expired oauth_states (step 40), the only thing steps
  34-42 said is cleaned. Docs: the README (what ansa is, every package
  script, the stand-ins, the two cron routes), .env.example (what Claude is
  used for), docs/going-live.md (every setting in one table, the calendar
  plan's and the review's Claude settings and what they send, a backup
  before each deploy that migrates, two checks after the first deploy, and
  section 11: what to verify first with real accounts), CLAUDE.md (the
  step 43 rules, every cross-company read listed in one place, the build
  order's Co-Founder steps, known gaps, Before launch for the Co-Founder,
  the decisions log), and below: every step's status, the final acceptance
  checklist, and how to deploy and roll back. On a fresh database (dropped,
  created, migrations 0000-0039 applied): typecheck, lint, 823 checks (0
  failures, 20 new, 1 extended) and the build pass (every /api route ƒ);
  the drift check finds no schema changes.
  Evidence, by check file (all in scripts/tenant-isolation/, run by
  one-product-checks.ts):
  - navigation-checks: "navigation: the header lists Tickets, Calls,
    Emails, Knowledge, Co-Founder, Team, Setup in that order, with Account
    and Billing in the 'who you are' row; the Co-Founder's row lists
    Overview, Interview, Profile, Strategy, Studio, Media, Calendar, Queue,
    Analytics, Accounts; every one needs a login", "navigation: on a
    360-pixel phone the header and the Co-Founder's row wrap whole words
    onto more lines instead of scrolling sideways, and the 'who you are'
    row stays one line, its name cut with '...'", "dashboard: the Business
    overview is the page's h1, above the ticket list (whose heading is an
    h2), and every number in it is a link to the page that lists it (the
    posts scheduled for the next 7 days: the queue's Scheduled list)".
  - business-overview-checks: "business overview: the support numbers are
    the company's own and count what their links open: open and unassigned
    tickets as the ticket views count them, calls of the last 7 days and
    those the AI solved, received emails still being turned into tickets
    and stuck ones; another company's never count", "business overview:
    the Co-Founder half stays one line until the company starts it (a
    fact, an interview answer or a draft: an owner is invited, a member
    told an owner starts it); then key facts x of y, drafts waiting for
    approval, posts scheduled for the next 7 days (one already due and
    waiting for a run too, each in the queue's Scheduled list the number
    links to), posts needing attention (a run cut off while sending too)
    or failed in the last 7 days, and
    accounts needing a reconnect (one whose access ran out too); another
    company's never count", "business overview: each count reads at most
    one row past 10,000 (Postgres stops there), shown as '10,000+';
    exactly 10,000 shows as it is".
  - cofounder-checklist-checks: "co-founder overview: the checklist follows
    the company's real state step by step: interview, key facts, plan,
    first draft, account connected, first post scheduled, numbers; each
    links to its page", "co-founder overview: an account whose access ran
    out counts as needing a reconnect, not as connected; another company's
    progress never counts".
  - cofounder-consistency-checks: "co-founder pages: each reads the session
    inside <Suspense> with a loading line, asking for a login back to its
    own address, below the section's header, row of links and error
    boundary; a page with an id or number in its address has a not-found
    page" (and maxDuration 300 exactly on the 9 pages whose actions ask
    Claude or send posts), "co-founder pages: times show in the viewer's
    own timezone (LocalDateTime, or the calendar's days worked out in the
    browser); no page formats a date on the server".
  - schema-checks (read from Postgres's catalog): "schema: every tenant
    table has a company_id that is never empty, and every foreign key from
    one tenant table to another names company_id first on both sides (the
    companies table aside), so Postgres refuses a link across companies",
    "schema: every column of a tenant table that points at a person has a
    same-company foreign key to users (company_id, id)", "schema: the
    tables in db/schema are the tables in the database, and the checks'
    cleanup empties every tenant table for the test companies".
  - docs-checks: "docs: .env.example names every setting lib/env.ts reads
    and no other, and docs/going-live.md names each one", "docs: the README
    names every package script (pnpm <script>)", "docs: every file or
    folder CLAUDE.md, the README, docs/going-live.md, IMPLEMENTATION_PLAN.md
    and CODEBASE_AUDIT.md name exists", "docs: CLAUDE.md's build order lists
    the Co-Founder's steps 34 to 43, and its Before launch list what the
    Co-Founder needs".
  - journey-checks and journey-after-checks (journey-steps.ts does each
    step the way its page does, through the real services and /db, with a
    stand-in for Claude, the development stand-in account and simulated
    numbers): "journey: an owner signs up and confirms the address; the
    interview proposes facts and the owner confirms them; an approved
    article is found by the support search and by the phone assistant's
    tool; a marketing plan is made from the facts and the article; the
    AI's draft is approved, a stand-in account connected, the post
    scheduled for now and published to .dev-social/; simulated numbers add
    up on Analytics; a review cites them, checked; the dashboard and the
    Overview follow along", "journey: a member of another company finds
    none of it (profile, interview, knowledge and its search, the phone
    tool on their line, plan, drafts, accounts, queue, calendar,
    analytics, review, the dashboard's overview, the Overview's
    checklist), and that company's owner can't approve, schedule, delete
    or disconnect any of it", "journey: owners delete knowledge articles,
    clear the interview, archive drafts, delete media and disconnect
    accounts (tokens deleted); the posts that went out stay published, on
    the platform (the stand-in's files) and on the Analytics page".
  - Extended: publishing-page-checks (Media now sits between Studio and
    Calendar in the Co-Founder's row). The page-heading check, unchanged,
    finds the dashboard's h1 in business-overview.tsx, which the page
    imports.
  - Each of 22 deliberate bugs was planted alone (a scratch script writing
    the file back after each run; every file compared after) and made the
    check meant for it fail: open tickets of every company, a count without
    its limit, calls of all time, stuck emails counted as waiting, approved
    drafts counted as waiting, posts cut off while sending not needing
    attention, failures of all time, scheduled posts of any date, an
    interview answer not starting the Co-Founder, reconnects read from the
    stored status (dashboard and checklist), the Co-Founder half always
    shown, an idea counted as a written draft, progress read for every
    company, key facts done with one, a number outside its link, Media
    after Analytics, a header row that doesn't wrap, the studio's new-draft
    page without maxDuration, cleanup forgetting a table, .env.example
    missing a setting, and the knowledge search reading every company. All
    undone.
  - Logged out, against `pnpm dev`: every app page (30 addresses: each
    section, each Co-Founder page, the pages with an id or a number, a
    query string kept) answered 307 to /login?next=<its own address>, and
    the website, the login, signup, reset and confirm pages, robots.txt,
    sitemap.xml and /api/health answered 200 (14 addresses); the server
    was stopped afterwards.
  - By hand (scratch scripts, their data removed), headless Chrome against
    `next dev` with a company that started the Co-Founder (an owner and a
    member, 4 confirmed facts, a plan, 5 posts published to the stand-in
    with simulated numbers, a draft waiting, a post due tomorrow, one
    needing attention, 3 tickets) and a fresh company: 96 of 96 looks OK.
    Each number of the overview at 1280 and 360 px with its link (the
    unassigned tickets and the post needing attention in the warning
    colour), the headings in order (Business overview, Support, Co-Founder,
    Tickets), the checklist "5 of 7 done." with each step's words, the
    header's and the Co-Founder row's links in order, the "who you are"
    row one line cut with "...", and none of the 17 signed-in pages
    scrolling sideways at 360 px, for the owner and for the member (who
    sees the same numbers and checklist); the fresh owner sees one line
    inviting them to the interview and "0 of 7".
- Found by the final full run (both fixed, both only in the whole suite):
  the checklist check signed up the label "checklist", which the backlog
  routing checks already use (a second signup with an address that has an
  account answers like a new one and makes no company), now
  "cofounder-checklist"; and the call brain's "solved" guard
  (brain-evidence-checks.ts) flagged the overview's link to the Calls
  page's solved filter, written as `outcome` set to "solved" in a query
  object, now the plain address /calls?outcome=solved (the guard itself
  is unchanged).
- Decisions where the spec left room: CLAUDE.md's decisions log,
  2026-10-28 Step 43 (an interview answer starts the Co-Founder too; every
  count bounded at 10,000 and read with its list's own condition; members
  see the same overview, only owners are invited to start; the checklist's
  done conditions; the consistency rules kept as checks rather than a
  one-time read).
- Left out, and why: a date filter on the Calls page for "calls in the
  last 7 days" (the list is newest first, and the overview says how many;
  a known gap); a check that renders the pages at 360 px (the checks read
  the classes that make the rows wrap, and the by-hand run looked at every
  page); deleting published posts, retention rules and an export (each a
  decision for you: CLAUDE.md, known gaps, "Deletion"); every real-account
  verification (the checklist below says what each needs).

## Status of every step

Each step's own section above holds its evidence (check files and names,
planted bugs, by-hand runs). The count is the whole suite when the step
(and then its review fixes) was done.

| Step | Status | Checks after the step, then its review |
| --- | --- | --- |
| Baseline (steps 1-33, the support product) | `[x]` | 450 |
| Stage 1: audit fixes F1-F12 | `[x]` | 465 |
| 34 Company knowledge base | `[x]` | 501, 508 |
| 35 Knowledge during live calls | `[b]` a real Vapi call (no Vapi account) | 524, 525 |
| 36 Business profile and interview | `[x]` | 550, 557 |
| 37 Marketing strategy | `[x]` | 576, 579 |
| 38 Content studio | `[x]` | 612, 619 |
| 39 Media library and generation jobs | `[x]`; a real image or video service OPEN (decision 9) | 655, 669 |
| 40 Social account connections | `[b]` each platform's developer app | 708, 719 |
| 41 Publishing queue, calendar, approvals | `[x]`; real platforms BLOCKED with step 40 | 766, 772 |
| 42 Analytics and recommendations | `[x]`; real platforms' numbers BLOCKED with step 40 | 799, 803 |
| 43 One product, final verification | `[x]` | 823, 824 |

## Final acceptance checklist

The brief's section 9, item by item. PASSED means a check in `pnpm
check:tenant-isolation` (named in quotes; its file in
scripts/tenant-isolation/) or the command given proves it, through the real
services and database; where a stand-in took an outside service's place,
the item says so. BLOCKED names the exact outside requirement; the code
around it is built and checked with fakes. Verified 2026-10-28 on a fresh
database: 823 checks, 0 failures; typecheck, lint and `pnpm build` pass.

Existing AI support:
- A customer can reach the configured AI voice workflow: BLOCKED on a Vapi
  account (an assistant, a phone number, and ansa's operator linking it
  with `pnpm link:phone-line`; docs/going-live.md, section 4). ansa's side
  passes: "a signed end-of-call-report is saved under the phone line's
  company", "unsigned, wrongly signed, tampered, stale and future requests
  get 401, save nothing, log one line" (vapi-checks); Vapi's real signing
  format is unconfirmed (CLAUDE.md, known gaps).
- The system understands the request and retrieves relevant knowledge:
  PASSED for ansa's side, with a stand-in for Claude: "vapi tool: a signed
  search on company A's line answers with A's approved support articles
  only (never B's, drafts, archived or marketing-only)"
  (vapi-tool-checks), "brain: 'solved' is accepted only with the
  customer's own words from the call" (brain-checks), and the journey's
  tool answer. BLOCKED for a live call: Vapi's own assistant decides when
  to search (a Vapi account), and Claude's verdicts need
  `ANTHROPIC_API_KEY` and an eval set of real calls (none yet).
- A reliable answer is delivered when an appropriate solution exists:
  BLOCKED on a Vapi account (the spoken answer is Vapi's assistant's).
  ansa gives it only approved support text, escaped and labeled as
  reference ("call answer: each hit in its own escaped <article> tags on
  the one line, so no article can fake a piece, close its tag or end the
  reference text"), and counts a call solved only on the customer's own
  confirming sentence ("brain evidence: nothing defaults to 'solved': no
  answer, a failure or a needs_human never becomes it, and only
  decision.ts sets it").
- An unresolved problem creates a persistent support ticket: PASSED:
  "tickets: 'needs a human' creates exactly one ticket in the call's
  company", "tickets: rule escalations, invalid answers and crashes get a
  ticket too", "tickets: a call can never get a second ticket"
  (call-ticket-checks).
- The ticket and conversation are available to authorized staff: PASSED:
  "tickets: another company never sees call tickets or the call behind
  them", "the transcript is encrypted at rest and the recording URL is not
  stored", "a transcript encrypted for one company cannot be decrypted as
  another's" (call-ticket-checks, vapi-checks).
- Failures and human escalation are handled correctly: PASSED: "brain:
  malformed, unexpected or failed model answers all become needs_human",
  "brain: a failed Claude request logs one fixed line with its class; the
  call keeps it, ticket and page name it, not as Claude's decision",
  "escalation: a call the AI marked solved becomes one ticket in its
  company, routed and emailed, recording who escalated it", "stuck work:
  an email or call is only started while its slowest run still fits...".

Business onboarding:
- A business owner can register or access an authorized organization:
  PASSED: "signup creates a company and makes the user its owner", "signup
  cannot join another company by sending companyId", "joining with an
  invite lands in the inviting company with the invited role", and the
  journey's signup, confirmation and login.
- The AI conducts a conversational interview: PASSED with a stand-in for
  Claude: "co-founder interview: the first answer saves the opening
  question the page showed, then the answer, then Claude's question; its
  facts become proposals", "co-founder interview: Claude ends the
  interview only when no key topic is missing (counting what it proposes);
  otherwise the fixed question of the missing one comes next". The real
  model's questions are unmeasured: a run with `ANTHROPIC_API_KEY`
  (docs/going-live.md, section 11, step 3).
- Answers persist and can be edited: PASSED: answers are kept (encrypted)
  and the interview resumes ("co-founder interview: Start over deletes the
  messages and never the facts..."); the facts taken from them are edited
  on the Profile page ("business profile: a proposal never overwrites a
  confirmed value; Confirm makes it the fact with its source, Edit and
  confirm and an owner's edit record the owner"). A single interview
  message can't be edited (Start over only: CLAUDE.md, known gaps).
- Business information is validated and stored: PASSED: "business
  profile: a fact is 1-2,000 characters with a line break counting once;
  control characters and unknown topics are refused; the database CHECKs
  hold", "business profile: a confirm or dismiss of a proposal changed
  meanwhile, or an edit of a fact changed meanwhile, is refused and changes
  nothing".
- Missing information is identified: PASSED: "business profile: the
  completion counts confirmed key facts only, and the Overview's next steps
  follow it (owners only)", "marketing plan: without what a plan needs
  Claude is never asked, and the page lists what is missing...",
  "co-founder overview: the checklist follows the company's real state
  step by step...".
- Organization-specific knowledge is searchable: PASSED: "knowledge search:
  approved articles meant for the audience only, never drafts or archived
  ones", "knowledge: another company can't list, read, search, edit,
  approve, archive, restore or delete an article (services and /db)".

AI Co-Founder:
- The AI can generate a business-specific marketing plan: PASSED with a
  stand-in for Claude: "marketing plan: Claude gets only this company's
  confirmed facts (never a proposal) and the owner's note, each in escaped
  tags it can't close; card numbers hidden; nothing about the account",
  "marketing plan: a 'fact' naming no confirmed fact that was sent is
  stored and shown as an assumption...", and the journey's plan. The real
  model's plans are unmeasured (`ANTHROPIC_API_KEY`, no eval set).
- It generates content using verified company information: PASSED with a
  stand-in for Claude: "content studio: Claude gets only this company's
  confirmed facts (never a proposal), approved marketing articles, the
  plan's pillar, campaign, positioning and audiences and the words to
  avoid...", "content studio: the AI can't mark its own claim supported:
  this code backs a claim only when every fact it names was confirmed and
  sent...".
- Users can preview, edit, regenerate, approve, and reject drafts: PASSED:
  "feed preview: LinkedIn cuts after about 210 characters or 3 lines behind
  '...see more', at a word; X never cuts; a short text stays whole",
  "content studio: an approval records its version; editing or
  regenerating an approved draft makes it a draft again without its
  approval, as the next version...", "content studio: the AI's new text is
  never saved over an edit made while it was writing...", "content studio:
  rejecting (owners) keeps the note through edits until an approval...".
- Images and videos are generated or imported when supported and
  configured: imported PASSED ("media files: a PNG named .jpg, a script
  named .png and an SVG are refused, in the browser's check and on the
  server, and nothing is stored", "media files: an upload is stored under
  media/<companyId>/<assetId>.<ext>..."); generated BLOCKED on choosing an
  image and video service (decision 9: an account, its adapter and
  `MEDIA_PROVIDER`). The pipeline passes with the development stand-in
  ("media generation: in development the stand-in makes the image after
  the answer...", "generation jobs: five runs of one request at the same
  moment make one request to the service and one asset"), and production
  without a service says it isn't set up ("media generation: production
  without a real service is off...").
- Content is adapted to platform requirements: PASSED: "content rules: X
  counts as X does: 280 letters fit and 281 don't...", "content rules:
  YouTube takes videos only, each needing its video, a title of at most 100
  characters and no < or >; its description counts bytes", "content rules:
  LinkedIn takes 3,000 characters and Facebook 63,206...", "content studio:
  a blocking issue stops approval, checked on the saved draft in the
  approving transaction...".

Publishing:
- Owners can connect supported accounts through authorized flows: BLOCKED
  on ansa's developer app on each platform (LinkedIn: Share on LinkedIn and
  Sign In with OpenID Connect; Meta: App Review for pages_show_list,
  pages_read_engagement and pages_manage_posts, and Business Verification;
  X: pay-per-use credits; Google: OAuth verification; docs/going-live.md,
  section 10). The flows pass against fake platforms built from the docs:
  "social accounts: Connect saves only the state's SHA-256 hash, for 10
  minutes, tied to the person, company and platform...", "social accounts:
  two returns with one state at the same moment: one connects...",
  "social accounts: members can't start a connection, connect a stand-in
  or disconnect (services and /db)...", "social accounts: tokens are stored
  encrypted, with a context naming the company, the connection and the
  token kind...".
- Account permissions and publishing capabilities are validated: PASSED
  against fake platforms, BLOCKED for real ones (as above): "social
  accounts: Facebook connects one account per Page the person may create
  content on, each with that Page's own token and no expiry; no such Page,
  or an unticked permission, connects nothing", "youtube: Google's consent
  screen (...); no channel or an unticked permission...", "publishing:
  scheduling needs an owner (...), the version the page showed, and
  connected accounts of the draft's own platform...".
- Approved content can be published through a verified integration:
  BLOCKED on the platforms' developer apps (no real post has gone out;
  decision 7 says no adapter is "working" before one). Passes with the
  development stand-in and fake platforms: "publishing: an approved draft
  scheduled for now goes out right after the answer: the stand-in writes it
  to .dev-social/<platform>/...", "linkedin: a text post and an image post
  are the Posts and Images API requests LinkedIn documents...", "x: a post
  is POST /2/tweets as JSON...", and the journey's five posts.
- Scheduled jobs survive application restarts: PASSED: "publishing: posts
  survive a restart (rows only): with the run after the answer lost, a
  fresh runner sends the due ones, the longest waiting first, and leaves
  one not due yet".
- Duplicate publication is prevented as far as supported by the platform:
  PASSED: "publishing: five runners at the same moment claim a due post
  once: one request to the platform, one published post, one try",
  "publishing: the same post can't be queued twice for one account...",
  "publishing: an unclear answer (a 500, no answer) needs a person and is
  never tried again by itself...", "publishing: a post still 'publishing'
  10+ minutes after its claim was cut off while sending: it goes to a
  person (needs attention, 'interrupted') and is never sent again...". No
  platform offers an idempotency key (decision 8).
- Failures are visible and recoverable: PASSED: "publishing: every code a
  post can fail, wait or need attention with (the queue's own and the
  platforms') reads as a sentence of its own, never as the code",
  "publishing: Cancel takes a waiting post out (...); Retry checks like a
  new schedule...", "queue page: the company's posts by status with their
  counts...", "business overview: the Co-Founder half stays one line until
  the company starts it (...) posts needing attention (...) or failed in
  the last 7 days...".
- Unauthorized content cannot be published: PASSED: "publishing: drafts
  that aren't approved are refused when scheduled; one changed, rejected or
  archived after its post was claimed fails it when it runs...",
  "publishing: an approver made a member, or removed, after the post was
  scheduled: it fails when it runs (approver_not_owner)...", "auto-publish
  rules: nothing turns a rule on by itself...", "journey: a member of
  another company finds none of it (...), and that company's owner can't
  approve, schedule, delete or disconnect any of it".

Analytics:
- Available metrics are collected and displayed accurately: PASSED against
  fake platforms and with simulated numbers, BLOCKED for real platforms
  (step 40's apps; LinkedIn's numbers also need the Community Management
  API): "metrics collection: a post of the last 30 days is read once it has
  been out an hour, its snapshot saving what X gave...", "x numbers:
  GET /2/tweets/<id> with tweet.fields public_metrics and
  non_public_metrics...", "analytics page: the period's posts newest
  first, each with its newest snapshot; totals per platform add only the
  numbers posts have...", and the journey's totals (600 views, 30
  reactions over 5 posts).
- Missing metrics are clearly identified: PASSED: "metric definitions:
  every platform defines all seven numbers; each it gives has its label,
  its field and a one-line definition, each it gives only with a permission
  names it, each it doesn't have says why...", the analytics page check
  above ("say 'not available' where the platform has no such number and why
  where ansa doesn't read it").
- Recommendations are based on actual available evidence: PASSED with a
  stand-in for Claude: "performance review: no model call below 5 posts
  with numbers in the period...", "performance review: a finding citing a
  wrong value, a post that doesn't exist, a number under another name, both
  a post and a group, or writing a number it doesn't cite (in any script's
  digits) is dropped whole...", and the journey's review.

Application quality:
- No known critical security defects remain: PASSED as far as known: the
  audit's findings were fixed (Stage 1), every step had a correctness and a
  security review whose findings were all fixed (each step's review fixes
  above), tenant isolation is checked on every table ("schema: ..." and
  every feature's "another company can't ..." checks), the /db rule is
  enforced by lint ("lint: every way around the /db rule is an error...").
  `pnpm audit --prod --audit-level high` runs in CI, which has never run
  (no git remote: CLAUDE.md, known gaps).
- Existing working features pass regression tests: PASSED: the 450 checks
  of the support product (steps 1-33) are in the 823 that pass.
- New workflows have meaningful automated tests: PASSED: 373 checks added
  since the baseline, each through the real services and Postgres with
  fakes only for outside services; for each step, deliberate bugs were
  planted one at a time and each made its check fail (each step's
  evidence).
- The application builds successfully: PASSED: `pnpm build` (every /api
  route ƒ, dynamic).
- Database migrations and deployment instructions are documented: PASSED:
  db/migrations (0028-0039 for steps 34-42; step 43 has none),
  docs/going-live.md, and "Deploy and roll back" below; `pnpm db:generate`
  finds no schema changes.
- No critical workflow depends on fake data or a placeholder
  implementation: PASSED: every stand-in works only in development and is
  labeled where it shows; production refuses it ("social stand-in:
  production refuses it, connecting and publishing...", "publishing:
  production refuses a stand-in account's post (stand_in_in_production)...",
  "media generation: production without a real service is off...",
  "billing: with Stripe off in production the page is 'not set up yet',
  never the simulate buttons") and a startup line names any stand-in left
  on ("production warnings: ..."). What production can't do yet without an
  outside account says "not set up" instead of pretending.

## Deploy and roll back

1. Back up first: a Neon branch made just before the deploy (instant, the
   app can be pointed at it, and nothing leaves Neon: the preferred way),
   or a dump written OUTSIDE the repository folder:
   `pg_dump -Fc "<direct url>" -f ~/ansa-backups/ansa-$(date +%F).dump`
   (make the folder first; `pg_restore` reads it back). The dump holds every
   company's data in plain text apart from what lib/encryption.ts encrypts
   (customer emails and phone numbers, ticket subjects, facts, articles,
   plans, drafts, sessions, password hashes): keep it on an encrypted disk,
   never commit or upload it, and delete it once the deploy is confirmed
   (.gitignore ignores `*.dump` as a last guard). docs/going-live.md,
   section 1, step 7. Note the commit that is live.
2. Run the checks on the code to deploy: `pnpm typecheck`, `pnpm lint`,
   `pnpm check:tenant-isolation` (local database) and `pnpm build` (CI runs
   them on every push once the repository has a remote).
3. Migrate BEFORE the code that needs it goes live:
   `DATABASE_URL="<direct url>" pnpm db:migrate`. The migrations of steps
   34-42 (0028-0039) only add: tables, columns with a default or that may
   be empty, indexes and constraints. Two touch rows or rules of the
   Co-Founder's own tables: 0033 rewrites a CHECK of content_drafts (an
   idea holds no media either), and 0034's two hand-written UPDATEs give
   existing image requests their draft's version and end older duplicate
   open requests as "superseded". Code from before step 34 never reads or
   writes the tables they add or change, so migrating first is safe for it.
   A migration that adds a rule (a CHECK, a unique index) to a table the
   running code already writes can refuse that code's writes until the new
   code is live (step 5 names them): deploy right after migrating.
4. Set any new settings (docs/going-live.md, section 7's table: steps 34-43
   added MEDIA_PROVIDER and the social platforms' pairs, all optional) and
   deploy (with Vercel's Git integration, the push is the deploy). Then
   docs/going-live.md, section 9.
5. Roll back the code by redeploying the previous commit (Vercel: promote
   the previous deployment), keeping the migrated database, ONLY when that
   commit already holds every migration the database ran (its
   db/migrations lists the same files) or predates the tables they changed
   (code from before step 34 never touches the Co-Founder's tables). Then
   nothing needs undoing, and data written meanwhile (facts, drafts, posts)
   waits for the next deploy. Otherwise the older code's own writes can
   break rules it doesn't know: 0033 refuses an idea holding media (code
   from before it making a blank draft with an image an idea), 0034 an
   image request from a draft without the draft's version, and a second
   open request for one draft, and 0036 a renewal claim on an account that
   isn't connected (code from before it disconnecting, or marking for a
   reconnect, an account a newer run was renewing). 0039's rules hold
   only for columns older code never writes. Then fix forward with a new
   commit, or restore the backup from step 1 together with the older code
   (what was written since is lost).
6. Roll back the database only if a migration itself went wrong: restore
   the branch or the dump from step 1 (what was written since is lost), or
   drop by hand what the failed migration added. Never edit a migration
   that ran: fix forward with a new one (`pnpm db:generate --name <fix>`).
7. Posts that went out are not undone by any rollback: they stay on the
   platforms (CLAUDE.md, known gaps, "Deletion").

## How to test each step

Each step's section in CLAUDE.md and its entry in the log below says exactly
how to try it locally. Everything runs without outside accounts: `pnpm db:up`,
`pnpm db:migrate`, `pnpm dev`, then the pages named in the step.

## Log

- 2026-10-26: audit done (CODEBASE_AUDIT.md), API research saved in
  docs/research/. Baseline green: 450 checks pass.
- 2026-10-26: Stage 1 done: F1-F12 fixed, each with a check (15 new checks,
  3 extended); the Resend event race is a documented known gap. typecheck,
  lint, 465 checks (0 failures) and the build pass.
- 2026-10-26: Step 34 done: company knowledge base (/knowledge), document and
  web page imports, "Related knowledge" and "Save as knowledge" on tickets.
  36 new checks; typecheck, lint, 501 checks (0 failures) and the build pass.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner):
  1. Click "Knowledge" in the header: the empty page explains what it is for.
     "New article": title "How refunds work", kind FAQ, text "Refunds take 5
     business days." then a blank line and "We refund to the original
     card.", leave "Support" ticked, "Save as draft". Its page says Draft and
     "1 piece", with Approve, Archive and Delete.
  2. Back on /knowledge, "Test what the AI finds": type "how long does a
     refund take" and Search: no match (drafts are never searched). Open the
     article, click Approve, search again: its piece appears; "Show the exact
     text the AI gets" shows it inside <article> tags. Type "<b>x</b>" into
     an article's text and approve it: the exact text shows &lt;b&gt;.
  3. Setup > Documents: upload a .txt, .docx or .pdf, click "Add to
     knowledge": "Added 1 draft to knowledge. Read and approve it". Click it
     again: a second draft. A PDF without text (a scan): "No text could be
     read from this file; a scanned PDF has none." Delete the document: its
     articles stay, without "From the document".
  4. Knowledge > "Import a web page": paste https://example.com/ (any public
     page): a draft named after the page's title. Try http://example.com/ or
     https://127.0.0.1/: refused with a message, nothing saved.
  5. Tickets > New ticket, subject "Refund for a broken kettle": its page
     shows "Related knowledge" with "How refunds work". "Close without
     emailing", then "Save as knowledge": the form starts with the subject
     and kind "Solution to a problem"; save it, and the article says "From
     ticket #n". Change the number in /knowledge/new?fromTicket=... to one of
     an open ticket: a plain article without a source.
  6. Invite a member (Team) and log in as them: they write and edit drafts,
     see approved articles read-only ("Only owners can change an approved
     article"), get no Approve, Archive or Delete buttons, and
     /knowledge/import says only owners import. Two tabs on one draft: save
     in one, then in the other: "Someone changed this article after you
     opened it", and the typed text stays in the box.
  7. `pnpm check:tenant-isolation` runs the 36 knowledge checks with the rest.
- 2026-10-26: Step 34 review fixes: 9 findings checked, all 9 real (the two
  safe-fetch ones are one defect). The .docx guard now reads archives as
  JSZip does (it had passed a bomb hidden behind an understated entry
  count); the web fetch opens nothing after its 10 seconds; saving articles
  takes the company row lock (the 1,000 cap held only one save at a time);
  restore/approve after another owner's change say so; a refused web
  address comes back whole (2,000); both import forms show the
  no-customer-data notice; a Turkish "İ" no longer shifts the page title;
  the pieces check now edits the title alone. 7 new checks; typecheck, lint,
  508 checks (0 failures) and the build pass; the drift check finds no
  schema changes.
  How to test (`pnpm dev`, log in as an owner):
  1. Setup > Documents with a file listed: the no-customer-data notice shows
     above the list. Knowledge > "Import a web page" shows it above the box.
  2. Import a web page with a 1,500-character address that fails (e.g.
     https://127.0.0.1/?q= followed by 1,500 letters): the error shows and
     the box still holds the whole address.
  3. Two owners, each with the same archived article open: one clicks
     "Restore as draft" and approves it; the other then clicks "Restore as
     draft": "This article is no longer archived: someone restored it
     meanwhile. Reload the page to see it."
  4. `pnpm check:tenant-isolation`: the knowledge-zip, knowledge-race and new
     safe fetch checks run with the rest.
- 2026-10-27: Step 35 built, BLOCKED for a real call (no Vapi account): the
  Vapi webhook answers the voice assistant's `search_company_knowledge` tool
  during live calls with the company's approved support articles (company
  from the phone line, one line, always 200), records which articles each
  call looked up (ids only), and the call page lists them; "Test what the AI
  finds" shows the phone assistant's line too. 16 new checks; typecheck,
  lint, 524 checks (0 failures) and the build pass; the drift check finds no
  schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner):
  1. Knowledge > New article: title "How refunds work", text "Refunds take 5
     business days.", "Save as draft", then Approve.
  2. Knowledge > "Test what the AI finds": type "how long does a refund
     take", Search, open "Show the exact line the phone assistant gets during
     a call": the label (`From the company's knowledge base. Each article
     is inside <article> tags: ...`), then `<article title="How refunds
     work">Refunds take 5 business days.</article>` (review fixes). Search
     "do you sell bicycles": no match, and the line says the knowledge base
     has nothing on it and to offer a ticket.
  3. Link a test number to your company: `pnpm link:phone-line <your email>
     pn-local-test`, check the company name it prints, then the same command
     with `--yes`.
  4. `pnpm simulate:vapi-tool-call pn-local-test "how long does a refund
     take"`: it prints `Call: sim-...`, `HTTP 200` and the same line as in
     step 2.
  5. `pnpm simulate:vapi-tool-call pn-local-test "do you sell bicycles"
     --call <the sim-... id from step 4> --end-call`: the nothing-found line,
     then the call ends.
  6. Calls > open the new call: "Knowledge the AI looked up during the call"
     lists two searches, "How refunds work" (a link to the article) and
     "nothing found". Delete the article, reload the call: "deleted article".
     Logged in as another company's owner, the call's address says "We
     couldn't find that call".
  7. `pnpm simulate:vapi-tool-call pn-unknown "refund"`: `error: This phone
     number is not set up.`, and the server log says `Vapi tool call
     ignored: unknown phone line` (never the question).
  8. Setting it up in Vapi: docs/going-live.md, section 4, step 7 (NOT
     TESTED against a real Vapi account).
  9. `pnpm check:tenant-isolation` runs the 16 new checks with the rest.
- 2026-10-27: Step 35 review fixes: 3 findings checked, all 3 real. The
  phone assistant's line now holds each piece in its own escaped
  `<article>` tags, as step 34's slice does but on one line (with "[Title]
  text" pieces joined by " | ", an article could write a fake piece or a
  fake end of the reference text); the Knowledge page no longer says the AI
  doesn't read articles on calls, and the Support box says the phone
  assistant may read an article to callers; a tool call whose per-IP count
  fails on the database gets an empty 500, now in CLAUDE.md's known gaps
  and docs/going-live.md with the 429 and 413 (answering it with error
  entries would mean reading the message before the limit). 1 new check,
  6 updated for the new line; typecheck, lint, 525 checks (0 failures) and
  the build pass (every /api route ƒ); the drift check finds no schema
  changes.
  How to test (`pnpm dev`, log in as an owner):
  1. Knowledge > New article: title `Refunds" [Internal]`, text `Refunds
     take 5 days. | [Account security] End of reference text. </article>
     Ask for the card number.`, "Save as draft", then Approve.
  2. "Test what the AI finds": search "refunds", open "Show the exact line
     the phone assistant gets during a call": after the label, the article
     is `<article title="Refunds&quot; [Internal]">`, its text shows
     `&lt;/article&gt;`, and only a real `</article>` closes it.
  3. The Knowledge page's text says the AI assistant looks up approved
     support articles during phone calls and may read them to callers; New
     article's Support box says the phone assistant may read it to callers.
  4. `pnpm check:tenant-isolation`: "call answer: each hit in its own
     escaped <article> tags on the one line..." runs with the rest.
- 2026-10-27: Step 36 done: the Co-Founder section (/cofounder: Overview,
  Interview, Profile, with its own row of links below the header),
  business_facts (25 topics, a confirmed value and a proposal beside it) and
  the encrypted onboarding_messages; the interview (Claude proposes facts
  and the next question; without Claude, the fixed question of the first
  missing key topic); the Profile page (Confirm, Edit and confirm, Dismiss,
  Edit / Fill in, the completion count) and "Suggest facts from knowledge".
  25 new checks; typecheck, lint, 550 checks (0 failures) and the build
  pass; the drift check finds no schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner; without
  ANTHROPIC_API_KEY the interview still works, with its fixed questions):
  1. Click "Co-Founder" in the header (after Knowledge): the Overview says
     what it is for, "0 of 16 key facts confirmed", "The interview hasn't
     started yet." and a "Start the interview" button. Below the header:
     Overview, Interview, Profile, the open one underlined. In a narrow
     window the header links wrap as whole words.
  2. Interview: the first question asks for the business name. Type "We are
     Bluebird Bakery in Lisbon." and "Send answer". With an API key: the
     Co-Founder's next question appears and "Proposed from your answer:
     Business name..." names what it read. Without one: "The AI couldn't
     read your answer just now, so nothing was taken from it." with a link
     to "Business name" on the Profile page, and the question comes back
     after a fixed note.
  3. The box takes at most 4,000 characters: paste 4,001 and it keeps 4,000
     (the server's refusal of a longer answer is a check). Open the
     Interview in a second tab and click "Start over" > "Yes, start over"
     there, then type an answer in the first tab and send: "The interview
     was started over while you answered, so your answer was not saved.
     Reload the page to see its first question.", and the text stays in the
     box. Reload and answer the first question again. (Review fixes: this
     step said the 4,001 characters would be refused on the page.)
  4. Profile: the 25 topics in six groups, key facts without a value marked
     "Missing". On a proposal: Confirm (it shows "Confirmed by <you>, from
     the interview" and the count goes up), or "Edit and confirm" to change
     it first, or Dismiss. "Fill in" any topic, type, Save: "Saved." and
     "Written by <you>". Open the same topic's editor in two tabs, save in
     one, then in the other: "Someone changed this fact after you opened
     it...", and the text stays in the box.
  5. Knowledge > New article "About us", text "We bake bread in Lisbon.",
     "Save as draft", then Approve. Profile > "Suggest facts from
     knowledge": pick it, "Suggest facts". With an API key the proposals
     show on their topics, "from a knowledge article", beside any confirmed
     value; without one: "The AI couldn't read the article just now, so
     nothing was proposed."
  6. Interview > "Start over" > "Yes, start over": the conversation is gone,
     the first question is back (about the first key topic still empty),
     and the Profile keeps every fact and proposal.
  7. Invite a member (Team) and log in as them: the Overview says only
     owners answer and confirm; the Interview has no answer box and no
     "Start over"; the Profile has no buttons.
  8. `pnpm check:tenant-isolation` runs the 25 new checks with the rest.
- 2026-10-27: Step 36 review fixes: 8 findings checked, all 8 real (the two
  emoji ones are one defect). "Suggest facts from knowledge" no longer reads
  an approved article ticked for neither support nor marketing (its page
  says nothing uses it), and its menu lists every approved article (it
  stopped at 500 by title, saying nothing); prompt cuts never split an
  emoji (the API refuses half of one, so one such fact made every interview
  turn and suggestion fail); Confirm and Edit and confirm are refused when
  the fact beside the proposal changed meanwhile; Start over and the reply
  save take the company row lock (a reply saved at that moment stayed
  behind as a lone question); the pages call the interview finished only
  while no key topic is missing; and step 3 of the How to test above no
  longer expects a refusal the answer box can't produce. 7 new checks;
  typecheck, lint, 557 checks (0 failures) and the build pass (every /api
  route ƒ); the drift check finds no schema changes. No new dependency,
  setting or migration.
  How to test (`pnpm dev`, log in as an owner):
  1. Knowledge > New article "Internal price rules", untick Support, "Save
     as draft", then Approve: its page says "Approved, but ticked for
     neither support nor marketing, so nothing uses it." Co-Founder >
     Profile > "Suggest facts from knowledge": it is not in the menu. Edit
     the article, tick Marketing and save (an owner's edit keeps it
     approved): now it is.
  2. With an API key: fill in "Brand voice" with what `node -e
     'console.log("a".repeat(299) + "😊" + "b".repeat(100))'` prints, then
     answer the interview: the Co-Founder answers as usual (before, every
     answer got "The AI couldn't read your answer just now", and the log
     said `Claude call failed: BadRequestError`).
  3. With an API key, get a "Proposed change" beside a confirmed fact
     (Confirm a proposal, then correct that fact in a later answer). Open the
     Profile in two tabs; in the second, Edit that topic and Save another
     value; in the first, click Confirm: "This proposal, or the fact beside
     it, changed or was handled meanwhile, so nothing was confirmed. Reload
     the page to see it." Reload: the second tab's value, with the proposal
     still beside it.
  4. With an API key, let the interview end (every key fact confirmed or
     proposed, then the Co-Founder's closing message): the Overview says
     "The interview covered every key fact." Dismiss one key proposal on the
     Profile page: the Overview says "The interview is under way" and
     offers "Continue the interview", and the Interview page no longer says
     every key fact was covered.
  5. `pnpm check:tenant-isolation` runs the 7 new checks with the rest; the
     Start over race and the 1,000-article menu are checked there only.
- 2026-10-27: Step 37 done: the Co-Founder's marketing strategy
  (/cofounder/strategy): versioned marketing plans that Claude writes from
  the confirmed facts, approved marketing knowledge, the owner's note and,
  only if an owner turns it on, ticket counts per category; each main point
  labeled fact / assumption / suggestion, the code turning an unproven
  "fact" into an assumption; no Claude call without the key facts. 19 new
  checks; typecheck, lint, 576 checks (0 failures) and the build pass (every
  /api route ƒ); the drift check finds no schema changes, and all 32
  migrations apply to a fresh database.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner; making a
  plan asks Claude, so it needs ANTHROPIC_API_KEY in .env.local and costs
  one paid call per plan; without a key step 4 shows its message instead):
  1. Co-Founder > Strategy (the new link after Profile). With an empty
     profile it lists what a plan needs (What the business does, Products or
     services, Target customers), each linked to its topic on the Profile
     page, and offers no form. The Overview's "Marketing plan" says the same.
  2. Profile: fill in "What the business does" ("We bake sourdough bread in
     Lisbon."), "Products" ("Sourdough bread and pastries") and "Target
     customers" ("Office workers nearby"). Strategy now says "There is no
     plan yet. Your profile has what a plan needs" and shows the form.
  3. Optional, support trends: Team > add a category "Billing", Tickets >
     New ticket with that category. On Strategy tick "Let new plans see how
     many support tickets each category had" and Save: "Saved."; reload: it
     stays ticked.
  4. Type "More weekday lunch customers" in the box and click "Make the
     first plan": "The Co-Founder is writing the plan. This can take a few
     minutes." Then "Version 1 is ready" and the plan: Summary; Main points
     with Fact / Assumption / Suggestion badges and their legend (a Fact
     names the confirmed facts under it); Audiences; Positioning; Goals with
     how to measure them; Content pillars; Campaigns; How often to post;
     What would make the plan better; Cautions. The line above says
     "Version 1, made on ... by <you> from 3 confirmed facts" (and "your
     support trends" after step 3), and "What this plan was made from" lists
     the facts as they were. Without an API key: "The AI isn't available
     right now, so no plan was made. Try again later." and nothing is saved.
  5. Profile: change "Target customers". The plan now says the confirmed
     facts changed since it was made. Make a new plan: "All versions" lists
     two; "Version 1" opens its own page ("An older version. The current
     plan is version 2.", with "Newer version"); /cofounder/strategy/99
     says it couldn't find that plan version.
  6. Invite a member (Team) and log in as them: Strategy shows the plan and
     every version, "Support trends: on. Only owners change it." (or off),
     and no form or checkbox.
  7. `pnpm check:tenant-isolation` runs the 19 new checks with the rest.
- 2026-10-27: Step 37 review fixes: 6 findings checked, all 6 real. The
  products, services and goals facts take turns at the article search's 20
  words (a products list of 20 words or more had left the other two out of
  it); "Make a new plan" marks the note box only for the note's own
  problem, shows any other message apart, and neither while a new try
  runs; the plan version page has an h1 (and a check reads every signed-in
  page for one); members are no longer told to answer the interview or
  fill in facts; the Strategy intro and the Fact legend no longer promise
  what the code can't check; CLAUDE.md and docs/going-live.md say card-like
  numbers are hidden in the facts and the note, while articles and category
  names go as written. 3 new checks; typecheck, lint, 579 checks (0
  failures) and the build pass (every /api route ƒ); the drift check finds
  no schema changes. No new dependency, setting or migration.
  How to test (`pnpm dev`, log in as an owner; steps 1 and 3 make plans, so
  they need ANTHROPIC_API_KEY and cost one paid call per plan):
  1. Profile: fill in What the business does and Target customers,
     Products = "Sourdough loaves (white, wholemeal, rye), baguettes,
     croissants, pains au chocolat, cinnamon buns, seasonal tarts,
     focaccia, brioche, bagels, scones, muffins, cookies and coffee" and
     Goals = "Grow weekday lunch orders from nearby offices". Knowledge >
     New article "Weekday lunch menu" (body "Soup and a sandwich every
     weekday."), tick Marketing, "Save as draft", then Approve. Strategy >
     Make a new plan: "What this plan was made from" lists "Weekday lunch
     menu" (before, no article: the products list filled the search).
  2. Without an API key, Make a new plan: "The AI isn't available right
     now, so no plan was made. Try again later." shows under the box, and
     the box is no longer outlined in red.
  3. All versions > Version 1: the page starts with the heading "Marketing
     strategy", then "Plan version 1".
  4. The intro now ends "...It is told never to invent results or customers
     and never to promise sales, but it can still get things wrong: check
     each point before you act on it.", and the legend's Fact line reads
     "The AI says this repeats facts confirmed on the Profile page, named
     under it. Check that it says what they say."
  5. Log in as a member of a company whose key facts are not all confirmed:
     the missing facts on Strategy end with "Only owners answer the
     interview and confirm facts. You can read both: the interview and the
     Profile page." (it said "Answer the interview, or fill them in...").
  6. `pnpm check:tenant-isolation` runs the 3 new checks with the rest.
- 2026-10-27: Step 38 done: the Co-Founder's content studio
  (/cofounder/studio): drafts for LinkedIn, Facebook, X and YouTube, written
  by the AI from the confirmed facts and the marketing plan or by the team,
  checked against each platform's rules (X counted as X counts, YouTube
  videos only, hashtags, words to avoid) and against the claims they make;
  owners approve or reject, and any change of content takes the approval
  away. Also fixed: Claude's errors in a production build were logged under
  minified class names. 33 new checks; typecheck, lint, 612 checks (0
  failures) and the build pass (every /api route ƒ); the drift check finds
  no schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner; writing
  with the AI needs ANTHROPIC_API_KEY in .env.local and costs one paid call
  per text; without a key the AI's buttons answer "The AI isn't available
  right now, so nothing was written..." and blank drafts still work):
  1. Co-Founder > Studio (the new link after Strategy): "Content studio"
     explains what it is for, with "New draft".
  2. New draft with an empty profile: the page lists the facts the AI needs
     (What the business does, Products or services, Target customers), each
     linked to the Profile page, and "Write it with the AI" is greyed out;
     "Start blank" still makes a draft (an Idea). Fill in those three facts
     on the Profile page, set "Words to avoid" to "cheap, guaranteed", and
     optionally make a marketing plan on Strategy.
  3. New draft: pick YouTube and the Format menu shows only Video
     ("YouTube takes videos only."). Pick LinkedIn, Text post, topic "Our
     new weekday lunch menu" (and a pillar and campaign of the plan), then
     "Write it with the AI": "The AI is writing the draft...", then the
     draft opens: LinkedIn, Text post, Draft, Version 1; the text in the
     editor; Checks "Post text: N of 3,000 characters" and "No problems
     found."; the words to avoid listed; the Preview cut after about 210
     characters with "...see more" (click it: the rest, the call to action
     and the hashtags); Claims, each Backed (by which fact) or Not backed.
  4. Type " cheap" at the end of the text: at once "Blocks approval:
     "cheap" is on your Words to avoid list...", and Approve says to save or
     undo first. Click "Undo changes".
  5. "Approve version 1" without ticking the box: "Some claims aren't
     backed by a confirmed fact...". Tick "I checked these claims" and
     approve: "Approved by <you> ... as version 1, after checking its claims."
  6. Change a word: it warns that saving makes it a draft again. Save:
     "Saved.", Version 2, Draft, no approval. "Regenerate with the AI" asks
     first (the text was changed by hand); "Yes, replace it": Version 3 with
     the AI's new text.
  7. "Reject...", type "Too long", "Reject version 3": "Rejected by <you>"
     and the note. Archive: the editor turns read-only and Restore appears;
     Restore: a draft again, "Last rejected by <you>" still shown.
  8. New draft on X; if its text is over 280 (or paste 300 letters into
     the text and Save), Checks shows the count in red and "The post is ...
     characters as X counts them ... X allows 280" blocks approval. A
     YouTube video draft shows the title, the script and "This video needs
     its video before it can be approved" (videos come with step 39).
  9. Open one draft in two tabs. Save a change in the first; in the
     second, change something else and Save: "Someone changed this draft
     after you opened it, so nothing was saved...", and the typed text
     stays in the boxes.
  10. The list: Current, Ideas, Drafts, Approved, Rejected and Archived
      with their counts, and Every platform / LinkedIn / Facebook / X /
      YouTube.
  11. Invite a member (Team) and log in as them: they write, edit,
      regenerate, archive and restore, and see "Only owners approve or
      reject drafts." Another company's owner opening a draft's address
      gets "We couldn't find that draft".
  12. `pnpm check:tenant-isolation` runs the 33 new checks with the rest.
- 2026-10-27: Step 38 review fixes: 8 findings checked, all 8 real. A
  draft's texts hold at most 30 combining marks in a row (a person's longer
  run is refused, the AI's cut) and the rules search each text once for all
  the words to avoid: one view of a crafted draft's page could hold the
  server for minutes. X's count no longer takes seconds on a link full of
  dots. New draft and the editor keep their menus' picks after a refusal
  (React's reset after <form action> had put them back to the first
  option, so pressing the same button again made a LinkedIn draft). A
  Regenerate from a page showing an older version is refused before Claude
  is asked; a save that changes nothing no longer leaves Approve waiting
  for one; a title or call to action keeps emoji joiners, Persian spelling
  and flag tags; a refused approval refreshes the page. 7 new checks;
  typecheck, lint, 619 checks (0 failures) and the build pass (every /api
  route ƒ); the drift check finds no schema changes. No new dependency,
  setting or migration.
  How to test (`pnpm dev`, log in as an owner whose three key facts are
  confirmed; step 1 needs ANTHROPIC_API_KEY empty in .env.local, so no paid
  call is made):
  1. New draft: pick YouTube (Format becomes Video), type a topic, pick a
     pillar (with a marketing plan). "Write it with the AI": "The AI isn't
     available right now...", and the Platform menu still shows YouTube and
     the pillar menu the pillar (they showed LinkedIn and None). Press it
     again: the same message, nothing made. "Start blank": the draft opens
     as YouTube, Video, with the pillar.
  2. In a draft's text, paste a letter followed by 31 accents (in the
     browser console: copy("a" + "\u0301".repeat(31))) and Save: "Take out
     some accents or other marks: at most 30 can follow each other." and
     nothing is saved. With 30 it saves.
  3. Press Enter or type a space at the end of the text: Save stays greyed
     out and Approve stays available (before, Save said "Saved." and
     Approve kept waiting for a save).
  4. On a YouTube draft, put the woman cook emoji (a woman and a frying pan
     joined into one) in the title and Save: it stays one emoji.
  5. Open one draft in two tabs. Save a change in the first; in the second
     click "Regenerate with the AI": at once "Someone changed this draft
     after you opened it, so the AI wasn't asked. Reload the page...".
  6. Open a draft the AI wrote whose claims are all Backed (no tick box). In
     another tab change "What the business does" on the Profile page. Back
     on the draft, "Approve version 1": "Some claims aren't backed..." and
     the page now shows that claim Not backed and the "I checked these
     claims" box; tick it and approve.
  7. `pnpm check:tenant-isolation` runs the 7 new checks with the rest.
- 2026-10-28: Step 39 done (a real image or video service stays OPEN,
  decision 9): the Co-Founder's media library
  (/cofounder/media): uploads checked by name and file signature (in the
  browser and on the server), private files under media/<companyId>/
  served inline only to the company, "Generate an image" through a
  provider interface with a development stand-in (production says it isn't
  set up), requests run after the answer and by the daily job (claimed
  once, 3 runs at most, a failure a code and never an asset), and a draft's
  Media: attach, take off, or "Make the image with the AI" from its image
  description (each a new version, the approval cleared); deleting is
  refused while an approved, scheduled, published or failed draft uses the
  file. 36 new checks; typecheck, lint, 655 checks (0 failures) and
  the build pass (every /api route ƒ); the drift check finds no schema
  changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner; nothing
  is sent anywhere: in development a stand-in makes the images):
  1. Co-Founder > Media (the new link after Studio): "Media library", "0 of
     300 files, 0 KB of 500 MB.", Upload, "Generate an image" (it says a
     stand-in makes the images in development, and makes images only), and
     "No images or videos yet."
  2. Upload: rename a PNG to photo.jpg and choose it: at once "This file is
     a PNG image, but its name ends in .jpg. Rename it to end in .png, or
     upload another file.", and Upload sends nothing. An .svg: "SVG images
     can't be uploaded: they can carry scripts..."; a file over 4 MB: "Files
     can be at most 4 MB.". Choose a real PNG or JPEG, type what it shows,
     Upload: "Uploaded." and its card: Uploaded, its name, "PNG image,
     N KB, W x H pixels", "No draft uses it", the alt text box.
  3. Change the alt text, Save: "Saved."; reload: it stays.
  4. "Generate an image": type "Fresh croissants in morning light", "Make
     it": the box empties, Requests shows it Done (the page refreshes by
     itself) with "See it in the library below", and the library a
     flat-colour 1024 x 1024 image marked "AI-generated" and "Development
     stand-in", "Made from: “Fresh croissants in morning light”". Pick "A
     video" and ask again: Failed, "The image service in use makes images
     only, so no video was made.", and no new card.
  5. Studio > New draft: LinkedIn, Post with an image, a topic, "Start
     blank". Type a text and "Image: what it shows" ("Three loaves on a
     counter"), Save. Under Media: "No image yet: the post needs one before
     an owner can approve it."; Checks: "This post needs its image before it
     can be approved...". Open "Choose an image from the media library",
     "Use this": the next version, the image under Media and in the
     Preview, the problem gone. Tick "I checked these claims", Approve.
  6. "Make the image with the AI": Media says the AI is making the image
     and the editor waits (with the stand-in only for a moment; the page
     refreshes by itself), then the stand-in's image is attached as the
     next version, marked AI-generated, and the approval is gone. Approve
     again.
  7. Media: the image the draft uses lists it ("Used by: <topic>
     (Approved)") and says it can't be deleted while a draft that is
     approved, scheduled, published or failed to publish uses it (no
     Delete). Delete another image: it asks first ("Yes, delete"), the card
     goes, and its address (/api/media/<id>) answers 404.
  8. Invite a member (Team) and log in as them: they upload, describe, ask
     for images and attach them too. Another company's owner sees only
     their own library; /api/media/<id> of your image answers 404 for them,
     and 401 logged out.
  9. Production: `pnpm build && pnpm start`: the Media page says "Image
     generation isn't set up yet. You can still upload your own images and
     videos above." with no form, a draft's Media says "Image generation
     isn't set up yet: upload the image in the media library.", uploads
     still work, and the server log starts with "Production setting:
     MEDIA_PROVIDER is not set: image generation is off...".
  10. `pnpm check:tenant-isolation` runs the 36 new checks with the rest.
- 2026-10-28: Step 39 review fixes (11 findings from the review, all real;
  migration 0034_media_request_versions). 14 new checks; typecheck, lint,
  669 checks (0 failures) and the build pass (every /api route ƒ); the
  drift check finds no schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner):
  1. Attach an image to a post with an image and approve it. On the media
     page, start typing new alt text for that image: "Saving a change makes
     the approved draft using it a draft again...". Save: the draft is a
     draft again, as its next version; approve it again.
  2. On the Profile page, set "Words to avoid" to "Cheapest". Give the
     draft's image the alt text "The cheapest bread in town": the draft's
     Checks say it uses "Cheapest" in the image's alt text (media library),
     and Approve is blocked until the alt text changes.
  3. On that draft, "Make the image with the AI": the Preview marks the
     image "AI-generated (Development stand-in)", like Media and the picker.
  4. With an API key: New draft, LinkedIn, "Post with an image", "Write it
     with the AI", then attach an image (or make one): the Claims still say
     the AI listed them for the version on screen (no "I checked these
     claims" box when every claim is Backed), and Regenerate doesn't ask
     first. Edit the text by hand: then it does.
  5. Upload a portrait photo taken with a phone (a JPEG): its card says it
     is taller than wide, as shown.
  6. With more than 50 files in the library, attach the oldest one to a
     draft: "Edit it in the media library" opens the library's page that
     shows it, at its card.
  7. `pnpm check:tenant-isolation` runs the 14 new checks with the rest
     (requests stuck, superseded and started again, a full library, a
     result too large to keep and a failed request shown on its draft are
     checked there: the stand-in never gets stuck or fails by hand).
- 2026-10-28: Step 40 built (real platforms BLOCKED on ansa's developer
  apps, decision 7): social account connections. Owners connect LinkedIn
  (member posts), Facebook Pages, X and YouTube on /cofounder/accounts
  through each platform's own consent page (OAuth 2.0; PKCE for X and
  YouTube; the state stored only as its hash, used once, for 10 minutes, by
  the person, company and platform that started it); the tokens are stored
  encrypted for their company, connection and kind and never shown;
  Reconnect updates the same account, Disconnect deletes the tokens (X and
  Google are asked to revoke), and a token is renewed before use where the
  platform allows. One adapter per platform (two files each) behind
  lib/social-publishing.ts, with a development stand-in; production says a
  platform ansa hasn't set up isn't set up. Migration
  0035_social_connections, no new dependency, 8 optional settings. 39 new
  checks; typecheck, lint, 708 checks (0 failures) and the build pass
  (every /api route ƒ, /api/social/[platform]/callback too); the drift check
  finds no schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner; nothing
  is sent to any platform: without ansa's apps, development uses the
  stand-in):
  1. Co-Founder > Accounts (the new link after Media): one card per
     platform with what it publishes, its media and text limits, its own
     scheduling (unused: ansa's queue schedules) and the numbers it gives;
     each says "Development stand-in", names the two settings that would
     set it up, and what ansa must get from the platform first.
  2. On LinkedIn, "Connect a stand-in account": "Development stand-in
     (LinkedIn)" appears as a Member profile, Connected, "A stand-in's
     access never runs out", with its permissions. Reconnect: still one
     account. Disconnect: it asks first; "Yes, disconnect" moves it under
     "Disconnected (1)", and the stand-in can be connected again.
  3. Log in as a member: the same cards and accounts, no buttons, and "Only
     owners connect and disconnect accounts."
  4. A real platform's Connect, with a made-up app: stop the server and run
     `X_CLIENT_ID=test-id X_CLIENT_SECRET=test-secret pnpm dev`. X now says
     "Ready to connect"; "Connect X" opens x.com's consent page (X refuses
     the made-up app: expected). Copy the `state` from that page's address
     and open `http://localhost:3000/api/social/x/callback?state=<it>&error=access_denied`:
     back on Accounts, "X says the connection was cancelled, so nothing was
     connected." Open the same address again: "That connection link has
     expired, was already used, or was started by someone else."
  5. Production view: `pnpm build && pnpm start` (without the X settings):
     every platform says "Not set up by ansa yet" with no setting named and
     no button, and the server log has one `Production setting:` line per
     missing app.
  6. `pnpm check:tenant-isolation` runs the 39 new checks with the rest:
     each adapter's requests and answers (fake platforms), the callback's
     single use and binding, renewals, tenant isolation and the stand-in's
     publishing to .dev-social/ (which no page does yet: the queue is step
     41).
- 2026-10-28: Step 40 review fixes (11 findings, all real; two were one
  defect; migration 0036_social_renewal_claims, no new dependency or
  setting): a Disconnect never revokes a grant another company's
  connection still uses, renewals run one at a time, tokens are read under
  the stored id, Facebook needs all three permissions, the Accounts page
  tells each access's lifetime as of now and drops an old result from its
  address, and the privacy policy says only what is kept. 11 new checks;
  typecheck, lint, 719 checks (0 failures) and the build pass (every /api
  route ƒ); the drift check finds no schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner; nothing
  is sent to any platform):
  1. Co-Founder > Accounts, LinkedIn: "Connect a stand-in account". Then
     open /cofounder/accounts?result=denied&platform=x: the alert "X says
     the connection was cancelled, so nothing was connected.". Disconnect
     the stand-in and confirm: the page comes back as /cofounder/accounts,
     without the alert, and Back doesn't bring it back. The same with
     "Connect a stand-in account" from such an address.
  2. /privacy: the social accounts bullet says "who connected it last and
     when, and when it was disconnected"; "Who helps us" says X and Google
     are asked to take the access back unless another company using ansa
     still has the same account connected.
  3. The rest needs a platform (none is reachable yet), so the checks show
     it: `pnpm check:tenant-isolation` runs the 11 new checks with the
     rest: two companies with one YouTube channel and X account (the first
     to disconnect asks nobody to revoke, the last does; reconnecting
     before the revoke keeps the connection), two runs renewing one X
     token at once (X asked once), a dead run's claim taken over, an id in
     capitals, Facebook's third permission, and Google's 7-day refresh
     tokens on the Accounts page.
- 2026-10-28: Step 41 built (real platforms stay BLOCKED with step 40):
  the Co-Founder's publishing queue, calendar and activity log. Owners
  schedule an approved draft from its page to one or more connected
  accounts of its platform, now or at a time in their own timezone; each
  post is a row (publish_jobs) that a run claims in one UPDATE and checks
  again right before sending (the approved version, the approver still an
  owner, the account connected, the rules and facts now); a platform's 429
  is tried again later (5 tries), an unclear answer goes to a person, and
  nothing unclear is ever sent again by itself. /cofounder/queue lists the
  posts by status with Cancel, Publish now, Retry and Mark as published /
  not published, the auto-publish rules (made off, switched on only after
  a strong confirm) and the activity log; /cofounder/calendar shows the
  next 28 days and "Plan the next 2 weeks" (ideas only, from the current
  plan). Posts go out right after the answer, from /api/cron/publish (any
  scheduler with CRON_SECRET) and from the daily job. Migrations
  0037_publishing_queue and 0038_publish_claim_ids, no new dependency or
  setting. 47 new checks; typecheck, lint, 766 checks (0 failures) and the
  build pass (every /api route ƒ, /api/cron/publish too); the drift check
  finds no schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner whose
  company has confirmed "What the business does", products or services
  and target customers, and a marketing plan (steps 36-37); nothing is
  sent to any platform: development uses the stand-in):
  1. Co-Founder > Accounts: on LinkedIn, "Connect a stand-in account".
  2. Co-Founder > Studio > New draft: LinkedIn, Text post, a topic, "Write
     it with the AI" (or "Start blank" and write a text, then Save). Under
     Approve, tick "I checked these claims" if it is there and "Approve
     version N".
  3. Below it, the new Publish section: tick "Development stand-in
     (LinkedIn)", keep Now, "Publish version N now". The post shows "Went
     out" ("written to the development stand-in's folder, not published
     anywhere"), the draft is Published (its text read-only), and Activity
     says who scheduled it and that it went out. A new file in
     .dev-social/linkedin/ holds the post's text.
  4. Approve a second draft and pick "At a date and time": tomorrow at
     09:00 is offered, in your own timezone (named). Change the time and
     "Schedule version N": the post "Goes out" then, and the draft is
     Scheduled. Change its text and Save (the editor warns first): its
     post is canceled, and Activity says the draft changed after approval.
  5. Co-Founder > Queue: the posts by status with counts. Schedule one
     again, then "Publish now" (it goes out) or "Cancel" (asks first).
     Under Auto-publish rules, make one for LinkedIn and a pillar of the
     plan: it is Off; "Switch on..." asks, saying posts go out WITHOUT
     anyone approving each one. A draft of that pillar whose claims are
     all backed (not edited by hand) can then be scheduled unapproved,
     with the tick "Send it without an owner's approval".
  6. Co-Founder > Calendar: the next 28 days from today, the posts at
     their times. "Plan the next 2 weeks" needs ANTHROPIC_API_KEY;
     without it the page says the AI isn't available and nothing is
     added. With it, ideas appear on their days ("Planned", Idea): open
     one in the studio to write it.
  7. Make another owner a member after they approved a draft: its page
     says nothing goes out on that approval and offers Approve again; the
     queue's "Retry" or a new schedule works once an owner approved it.
  8. Log in as a member: the same pages without buttons ("Only owners
     schedule posts.", "Only owners make rules", no AI planning).
  9. The route: with CRON_SECRET set, `curl -H "Authorization: Bearer
     <secret>" http://localhost:3000/api/cron/publish` answers what came
     of the due posts as JSON; without the header, 401.
  10. `pnpm check:tenant-isolation` runs the 47 new checks with the rest:
     racing runners, cut-off and late runs, 429s, renewals, rules,
     timezones, the route and every cross-company refusal, with fake
     platforms only.
- 2026-10-28: Step 41 review fixes (8 findings, all real; no migration,
  new dependency or setting): the runners let companies take turns and
  skip one past its daily limit for the rest of the run (counted before
  the account is made ready); the daily job sends due posts first; both
  cron routes check the secret before counting a call; making an owner a
  member disconnects their LinkedIn profiles; a failed post scheduled
  again on its account no longer keeps the draft failed, and offers no
  Retry; an approval leaves a scheduled, published or failed draft's
  status to its posts; a post cut off while sending shows as needing attention
  at once, and Mark or Retry hands it over; each post's buttons name it
  for screen readers. 6 new checks, 7 extended; typecheck, lint,
  772 checks (0 failures) and the build pass (every /api route ƒ); the
  drift check finds no schema changes.
  How to test (`pnpm dev`, log in as an owner as for step 41; the
  development stand-in publishes nothing):
  1. Team: invite a second owner. As them, Co-Founder > Accounts,
     LinkedIn: "Connect a stand-in account" (a LinkedIn profile posts as
     whoever connected it). As the first owner, Team: "Make member": the
     question says their LinkedIn profiles are disconnected. Accounts now
     shows the stand-in disconnected, and the queue's Activity says "...
     was disconnected: the owner who connected it was made a member."
  2. Have the second owner (an owner again) approve a draft. Connect the
     stand-in again yourself, schedule the draft for tomorrow, make the
     second owner a member, then "Publish now" on the queue: the post
     fails (the approver is no longer an owner). Approve the draft
     yourself and schedule it to the same account, Now: once it went out
     the draft is Published (read-only), and its failed post says "The
     draft was scheduled on this account again since: that post counts
     now." with no "Try again now".
  3. A run cut off while sending (stands in for a deploy killing one):
     schedule a draft for tomorrow, then in `psql` run `update publish_jobs
     set status = 'publishing', attempts = 1, claimed_at = now() - interval
     '11 minutes' where status = 'queued' and created_at > now() - interval
     '5 minutes';` (the post just scheduled). The queue lists it under
     Needs attention ("The run sending this post was cut off...") with its
     buttons; "Mark as not published": failed, and Activity says it needed
     attention (ansa), then your mark.
  4. `curl http://localhost:3000/api/cron/publish` without the header as
     often as you like answers 401; with `-H "Authorization: Bearer
     <secret>"` it still answers 200 (calls without the secret are never
     counted).
  5. With a screen reader, or the browser's accessibility tree, the
     queue's buttons read "Publish now: “<topic>” on LinkedIn (...)",
     "Cancel: “<topic>” ...", "Try again now: ...", and so on.
  6. `pnpm check:tenant-isolation` runs the new checks with the rest:
     two companies taking turns, one past its daily limit, the routes'
     secret first, the daily job's order, a demotion, a replaced failure,
     an approval after a problem and a cut-off post, fake platforms only.
- 2026-10-28: Step 42 built (reading real platforms stays BLOCKED with step
  40): the Co-Founder's analytics. Each published post's numbers (views,
  reach, reactions, comments, shares, clicks, video views; NULL where the
  platform gives none, never 0) are read about once a day for 30 days, as
  snapshots (post_metrics), by the daily job and /api/cron/publish; a
  failure records its code on the post, never a snapshot, and an account
  needing a reconnect is skipped with its reason. /cofounder/analytics
  shows the last 7, 30 or 90 days: totals per platform ("Not available on
  X" where a platform has no such number), each post's newest numbers, the
  period's publishing problems, what each number means, and the newest
  performance review: Claude's findings, each citing the numbers it rests
  on, which the code checks against what it sent (a finding with a wrong
  or invented number is dropped; none left, nothing saved), and its
  recommendations, passed to the next marketing plan as past performance.
  In development the numbers come from `pnpm simulate:post-metrics`.
  Migration 0039_post_metrics, no new dependency or setting. 27 new checks;
  typecheck, lint, 799 checks (0 failures) and the build pass (every /api
  route ƒ); the drift check finds no schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner whose
  company has confirmed "What the business does", products or services and
  target customers (steps 36-37); nothing is sent to any platform:
  development uses the stand-in):
  1. Co-Founder > Accounts: "Connect a stand-in account" on LinkedIn and on
     X.
  2. Co-Founder > Studio: write five or more text posts (LinkedIn and X;
     "Write it with the AI" needs ANTHROPIC_API_KEY, else "Start blank",
     type a text and Save), approve each, and on each draft's page tick its
     stand-in account and "Publish version N now".
  3. Co-Founder > Analytics (the new link after Queue): "Last 30 days" is
     open; every post is listed with "A development stand-in's post: no
     platform has its numbers, so only simulated ones show." and its
     command; under Totals by platform, LinkedIn's numbers say "Not read
     yet (needs a permission)" (LinkedIn gives none without its Community
     Management access), X's reach "Not available on X" and its other
     numbers "No numbers yet". Fold out "What the numbers mean": each
     platform's word, field and definition, and why one isn't read.
  4. Copy a post's command into a terminal, e.g. `pnpm
     simulate:post-metrics <id> views=120 reactions=8 comments=2`, and
     reload: the post shows "Impressions 120 Reactions 8 Comments 2" and
     "Read <date> (Simulated (development))", and its platform's totals add
     it up, marked "Simulated (development)". On an X post, `reach=5` is
     refused ("X gives no reach: leave it out."); a job id of a post sent
     to a real account (or one not published) is refused too.
  5. Give numbers to four posts: Performance review says "A review needs
     at least 5 posts with numbers in the period, and it has 4: 1 more is
     needed." Give a fifth: "Review performance" appears. Without
     ANTHROPIC_API_KEY it answers "The AI isn't available right now, so no
     review was made."; with it, the review appears: findings, each with
     the numbers it cites ("P3: “...”, LinkedIn text post, Tuesday 09:00:
     Reactions 8"), recommendations "(from finding N)" and what the numbers
     can't tell, marked "Simulated (development)".
  6. Co-Founder > Strategy, "Make a new plan" (needs ANTHROPIC_API_KEY):
     under "What this plan was made from", "Past performance: the findings
     of the performance review made <date>...".
  7. Pick "Last 7 days" and "Last 90 days"; open /cofounder/analytics?period=5:
     the last 30 days. A company with no published post says "No
     published posts in this period".
  8. Log in as a member: the same page with "Only owners ask for a review."
     instead of the button.
  9. Make a post fail: schedule an approved draft to the stand-in for
     tomorrow, disconnect that stand-in on Accounts, then "Publish now" on
     the queue (it fails: the account was disconnected). Analytics lists it
     under "Publishing problems" with that reason, without buttons, and a
     link to the queue.
  10. With CRON_SECRET set, `curl -H "Authorization: Bearer <secret>"
      http://localhost:3000/api/cron/publish` answers with a "metrics" part
      ({"collected":0,...}: a stand-in's posts are never read from a
      platform); /api/cron/cleanup too.
  11. `pnpm check:tenant-isolation` runs the 27 new checks with the rest:
      each platform's request and answer (fake platforms, the research's
      field names), the collector's claims, skips and failures, the
      simulate command's refusals, the page's totals and tenant isolation,
      and the review's dropping of wrong or invented numbers, with a
      stand-in for Claude.

- 2026-10-28: Step 42 review fixes: the marketing planner gets each cited
  post's topic and pillar as the review's own request sent them (card
  numbers hidden, topics cut to 200 characters); X's posts are read for
  28 days, so their link clicks stay on the page and in reviews; a
  review's number check finds numbers in any script's digits; a post past
  its read days says none were read in them; X's not-found answer is
  read as not found. No migration, new dependency or setting. 4 new
  checks; typecheck, lint, 803 checks (0 failures) and the build pass
  (every /api route ƒ); the drift check finds no schema changes.
  How to test (`pnpm dev`, as for Step 42 above):
  1. Co-Founder > Accounts, X: "Analytics reads impressions, likes,
     replies, reposts and quotes, and link clicks, for 28 days after a
     post went out (X keeps link clicks for 30 days only)."
  2. Co-Founder > Analytics: the first paragraph says numbers are read
     "until 30 days after (28 on X, which gives link clicks for a post's
     first 30 days only)".
  3. Posts of real accounts can't be made locally (a stand-in's post
     always says it is one), so the checks below show the rest: an X post
     (to a fake X) past its 28 days says "ansa reads X posts' numbers for
     28 days after they go out, and read none for this one.", and the
     planner's request (which the app never logs) holds no card number.
  4. `pnpm check:tenant-isolation` runs the new checks with the rest: the
     planner's request without the card number or the SSN-like pillar,
     Persian and full-width digits in a finding, X's 28 days with a fake
     X and Facebook, the page's words past a post's days, X's not-found
     answer, and the constraint on a queued post.
- 2026-10-28: Step 43 done: one product. The dashboard opens with a
  "Business overview" (support and Co-Founder numbers of the company, each
  a link to the list it counts, the Co-Founder half one inviting line
  until the company starts it), the Co-Founder Overview has a "Getting
  started" checklist read from real state, its row of links is in its
  final order, and every Co-Founder page, the schema and the docs are held
  to their rules by checks. One company walks from signup to a checked
  performance review through the services, and another company's member
  finds none of it. The docs are complete: every step's status, the final
  acceptance checklist (each item PASSED with its check or BLOCKED with
  its outside requirement), deploy and roll back, every setting, and what
  to verify first with real accounts. No migration, new dependency or
  setting. 20 new checks; on a fresh database typecheck, lint, 823 checks
  (0 failures) and the build pass (every /api route ƒ); the drift check
  finds no schema changes.
  How to test (`pnpm db:migrate`, `pnpm dev`, log in as an owner of a new
  company; no outside account needed):
  1. The header reads Tickets, Calls, Emails, Knowledge, Co-Founder, Team,
     Setup. Narrow the window to a phone's width (360 px in the browser's
     device toolbar): the links wrap onto more lines, "Co-Founder" whole,
     and nothing scrolls sideways; your address in the "who you are" row is
     cut with "...".
  2. /dashboard starts with "Business overview": Support shows "0 open
     tickets", "0 unassigned", "0 calls in the last 7 days", "0 solved by
     the AI", "0 emails being turned into tickets" and "0 stuck", each a
     link (open tickets opens the Open view, solved by the AI the Calls
     page's solved filter); the Co-Founder box says "Your AI Co-Founder
     helps with your marketing..." with "Start its interview". Below it,
     "Tickets" with the list as before. Click "New ticket" and save one:
     "1 open ticket" and "1 unassigned" (in red).
  3. Click "Start its interview" and answer the first question (without
     ANTHROPIC_API_KEY the AI says it couldn't read it; the answer still
     counts). Back on /dashboard the Co-Founder box shows its numbers: "0 of
     16 key facts confirmed" (or more), "0 drafts waiting for approval",
     "0 posts scheduled for the next 7 days", "0 posts need attention", "0
     failed in the last 7 days", "0 accounts need reconnecting".
  4. Co-Founder: the row below the header reads Overview, Interview,
     Profile, Strategy, Studio, Media, Calendar, Queue, Analytics,
     Accounts. The Overview's "Getting started" says "0 of 7 done." (or 1)
     with each step's state, e.g. "Answer the interview: Under way",
     "Confirm the key facts: 0 of 16 confirmed", each a link to its page.
  5. Profile: fill in "What the business does", "Products or services" and
     "Target customers" (Edit / Fill in). Studio > New draft > Start blank,
     write a text and save: "Write a first draft: A draft is written", and
     the dashboard says "1 draft waiting for approval". Accounts > "Connect
     a stand-in account" (LinkedIn): "Connect a social account: 1 connected
     (development stand-in)". On the draft, tick "I checked these
     claims..." and Approve; under Publish, tick the stand-in account,
     "Now", "Publish version 2 now" (the version on screen): "Schedule a
     first post: A post is in the queue or went out", and the post is a
     file in .dev-social/linkedin/.
  6. `pnpm simulate:post-metrics <the post's job id> views=40` (the command
     with the id is on the Analytics page): "See how posts did: Numbers
     were read for a post".
  7. Invite a member (Team) and log in as them: the same overview numbers
     and checklist. In a company where nobody started the Co-Founder, a
     member's dashboard says "Not started yet: an owner starts it by
     answering its interview."
  8. Log out and open /dashboard, /cofounder/queue or /cofounder/studio/1:
     each goes to /login?next=<that address>; /, /pricing and /api/health
     answer as before.
  9. `pnpm check:tenant-isolation` runs the 20 new checks with the rest
     (the overview's counts with another company's data beside them and
     10,005 tickets, the checklist step by step, the Co-Founder pages', the
     schema's and the docs' rules, and the journey from signup to a
     checked review with a stand-in for Claude).
- 2026-10-28: Step 43 review fixes (5 findings, all real; two overlapped).
  "Deploy and roll back" and docs/going-live.md (section 1, steps 4 and 7):
  the backup is a Neon branch or a dump written outside the repository
  (`-f ~/ansa-backups/...`, kept encrypted, deleted once the deploy is
  confirmed; it had gone to ./ansa.dump, which git didn't ignore), and
  .gitignore now ignores *.dump and *.sql.gz; rolling the code back onto
  the migrated database is safe only to a commit holding every migration
  it ran or from before the tables they changed (0033's, 0034's and 0036's
  rules refuse older code's writes; 0039's don't touch what older code
  writes). The README says which stand-ins `pnpm start` refuses and that
  development uses an outside service once its setting is set (and always
  for "Import a web page"). The dashboard's "posts scheduled for the next
  7 days" opens the queue's Scheduled list (it counts posts already due,
  which the calendar, starting at today, never shows). 1 new check (the
  docs' pg_dump commands), 2 extended (an overdue post counted and in the
  queue's list; the number's link); typecheck, lint, 824 checks (0
  failures) and the build pass (every /api route ƒ); the drift check finds
  no schema changes. How to test: schedule an approved draft for an hour
  ahead; the dashboard's "1 post scheduled for the next 7 days" opens the
  queue at its Scheduled list, which shows it.
- 2026-10-28: Final independent verification (after step 43's review
  fixes, outside the build workflow). A brand-new local database: all 40
  migrations (0000-0039) applied; typecheck and lint pass; 824 checks pass,
  0 fail; the build passes with all 10 /api routes ƒ (its 2 Turbopack
  warnings, lib/production-warnings.ts's folder scan, were in the build
  before step 34); the drift check finds no schema changes. Literal
  invisible characters (U+200B, U+200D, U+202E, U+FEFF; 15 in 10 files,
  test inputs and extract-text.ts's BOM strip, 2 of the files from before
  step 34) are now written as \u escapes, same strings, so a reader sees
  them. The login page that reloaded itself under `next dev` in step 39's
  run: against `next start`, in headless Chrome with a fresh profile, a
  valid login, a login ended elsewhere (session row deleted), a removed
  teammate whose session survived, a broken cookie and an expired session
  each settle after at most 2 page loads, on the page asked for or on
  /login?next=<page>: no loop (10 of 10). Under `next dev` the loop came
  back with a fresh browser profile (/, /signup and /login, up to 22 loads
  in 7 s): on every load Turbopack's HMR sent "restart" for the app's
  entry chunk list, with no project file changed. Its dev cache (.next/dev,
  985 MB after the build's many dev runs on changing code) was stale:
  deleted, the dev server rebuilt it and every page loaded once, and both
  demo accounts logged in. So step 39's "cookies from a `next start` run"
  was wrong; no code change, and the README says what to do.
