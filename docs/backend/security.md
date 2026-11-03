# Security rules

These rules are not optional. A change that breaks one is a bug, even if it
"works". Each rule says where it is enforced and which test proves it.

## 1. Companies are kept apart (tenant isolation)
- Every table holding a company's data has `company_id`.
- In core, every database function that touches such a table takes a
  `tenant.CompanyID` as its first argument and puts it in EVERY `WHERE` and
  EVERY `INSERT`. A plain `string` is not accepted, so a company id can't be
  passed by mistake.
- The company comes from the server side only: a verified session, a webhook
  secret core issued (a Telegram link code, a Page connected in exactly one
  company, a WhatsApp number connected in exactly one company), never from
  the request body.
- Cross-company reads (scheduled jobs that find due work) are listed in
  `core/internal/database/CROSS_COMPANY.md` and return ids only.
- Test: `core/internal/database/tenant_test.go` reads every SQL statement in core and
  fails if one touching a company table has no `company_id` condition.

## 2. Secrets
- All secrets come from environment variables, checked at start
  (`core/internal/config`): a missing or malformed one stops the process with
  a message naming the setting, never its value.
- Never in code, logs, error messages, URLs or the brain's requests, with ONE
  exception: a business's own AI key (stored encrypted) is decrypted by core
  and sent to the brain inside the signed request that uses it, over the
  private connection; the brain uses it for that one model call and never
  stores or logs it.

## 3. Logging
- Logs are JSON lines with a fixed message and safe fields only (an error's
  type, a code, a count).
- NEVER logged: message text, names, emails, phone numbers, tokens, keys,
  prompts, AI answers, request bodies, error messages from outside services.
- Enforced by `core/internal/logging` (only typed, allowed fields) and its test.

## 4. Webhooks: always this order
1. Size cap. 2. Raw bytes. 3. Signature or secret, compared in constant time.
4. Rate limit. 5. Parse JSON. 6. Validate every field. 7. Save.
Nothing is parsed before the signature is checked.

## 5. Encryption at rest
- AES-256-GCM, 12-byte random IV, full 16-byte tag, format
  `v1:<iv>:<tag>:<ciphertext>` (base64), a context naming company and record
  as additional data: a value copied to another company's row can't be read.
- `core/internal/secure`, tested against values the old TypeScript code wrote.
- Third-party tokens (social accounts, Facebook Pages, WhatsApp numbers) are
  decrypted only in `core/internal/social` (`TestOnlyThisPackageDecryptsTokens`);
  other packages may only encrypt the one a platform gives.

## 6. Core ↔ brain
- The brain listens on a private address only (`127.0.0.1` in development, a
  private network in production).
- Every request from core is signed: HMAC-SHA256 over
  `<timestamp>.<body>` with `BRAIN_SHARED_SECRET`, sent in
  `X-Ansa-Timestamp` and `X-Ansa-Signature`; the brain refuses an unsigned,
  badly signed or older-than-60-seconds request.
- Core sends only what one answer needs. The brain has no database access.
- Core checks every proposal before it reaches a customer (prices, links,
  refund and offer words); the brain's own text is never trusted blindly.

## 6b. Screens ↔ core
- Core's API (`/api/v1/...`) is called only by the Next.js server, over the
  private network. Every request is signed (HMAC-SHA256 with
  `SCREENS_SHARED_SECRET` over the method, the path and the body, within 60
  seconds) AND carries the person's Better Auth session cookie, which core
  verifies itself (`core/internal/session`). The company comes from that
  session only; a body naming a company is refused (unknown fields are).
- Test: `core/internal/api/api_test.go`, `core/internal/session/session_test.go`.

## 7. Inputs
- Every input is validated with an explicit schema (Go structs with checks;
  Pydantic in Python) before it is used. Unknown fields are refused where the
  sender is ours, ignored where it is a platform's.

## 8. Supply chain
- core: the Go standard library first. Every outside module is listed in
  `docs/backend/dependencies.md` with why it is needed, at an exact version
  (`core/go.mod`, `core/go.sum`).
- brain: exact versions in `brain/requirements.txt`, each with why in
  `dependencies.md`.
- Known advisories: CI's audit job checks the screens' production packages
  (`pnpm audit`). Core's and the brain's are not checked automatically yet:
  before a release, run `govulncheck ./...` in `core/` and `pip-audit -r
  requirements.txt` in `brain/` (both read public advisory lists from the
  internet).
- No package is added without a line in `dependencies.md`.

## 9. Rate limits
Counters in PostgreSQL (the `rate_limits` table), keyed by an HMAC of the IP or
account, never the plain value.

## 10. Before every change
Re-read this file. Run the checks (`make check` in `core/`, `pytest` in
`brain/`, and for the screens `pnpm typecheck`, `pnpm lint` and
`pnpm check:screens`).
