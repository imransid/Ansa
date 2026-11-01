# Architecture

## Why three parts

| Part | Language | Why this language |
|---|---|---|
| core | Go | Memory-safe, compiled and fast; thousands of chats and calls at once; a large standard library, so very few outside packages (a smaller supply-chain risk); Go's compatibility promise keeps today's code building for years. |
| brain | Python | The AI world's language: model SDKs, memory tools, voice-agent frameworks, evaluation and learning. |
| screens | TypeScript (Next.js) | The website and dashboard already exist and work well. |

The research behind this choice is in the owner's local reports
(`~/Documents/business/ansa-backend-language-rd.md`).

## Responsibilities

### core (Go): everything that acts
- Receives every webhook (Telegram, Meta, email, phone, Stripe) in the strict
  order of [security.md](security.md).
- Owns the database: it is the ONLY code that reads or writes PostgreSQL.
- Keeps companies apart: every query names the company.
- Decides what may happen (paused, taken over, important person, rate limits),
  asks the brain, checks the brain's proposal (prices, links, refunds,
  offers), and sends it.
- Runs background jobs (scheduled posts, catch-up replies, post numbers,
  cleanup) from a job queue stored in PostgreSQL.
- Serves the screens through an internal API.

### brain (Python): everything that thinks
- Receives a request from core with ONE company's slice of data (never ids it
  doesn't need, never another company's data).
- Builds the AI prompt, calls the model, reads the answer strictly, and
  returns a proposal.
- Has no database access and keeps no state: memory is stored by core and
  sent with each request (see "Memory" below).
- Is reachable only from core, on a private address, and refuses any request
  core didn't sign.

### screens (Next.js): everything people see
- Pages and forms. Every change goes through core's API; no database access.

## How a customer's message travels

1. Telegram calls `POST /webhooks/telegram` on **core**.
2. Core checks size, the secret, the rate limit; parses and validates; saves
   the message encrypted; answers Telegram `200`.
3. After the answer, a **job** "answer this message" runs:
   - core checks whether ansa may answer (paused? taken over? away rules?),
   - core gathers the company's slice (details, hours, menu, the newest
     messages of this one conversation),
   - core calls **brain** `POST /v1/assistant/reply` (signed),
   - brain asks the model and returns `reply`, `needs_person`, `no_reply` or
     an order step,
   - core runs its checks; if they pass it sends the reply through Telegram
     and records it; otherwise it sends the holding reply and alerts the owner.
4. The screens show the conversation from core's API.

## Memory (the brain's "long-term memory")

Memory belongs to one company and, inside it, to one customer. Core stores it
(PostgreSQL with `pgvector`) and enforces the company on every read; the brain
receives the memories relevant to the request and may return new ones to
keep. Core decides what is stored. The brain never fetches memory itself.

## Data

- One PostgreSQL database, the same tables as today (`db/migrations/`, plain
  SQL). Until the switch-over, both backends use them; afterwards core owns
  the migrations.
- Sensitive text is encrypted with AES-256-GCM in the `v1:` format of
  `core/internal/secure` (identical to the old `lib/encryption.ts`).

## Scaling path

1. One core process and one brain process (today).
2. Several core and brain processes behind a load balancer; the job queue in
   PostgreSQL shares work between them (`FOR UPDATE SKIP LOCKED`).
3. Busy areas (channels gateway, voice) become their own services only when
   one really needs it.
