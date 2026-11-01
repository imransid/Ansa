# api (core/internal/api)

**What:** core's API for the screens: JSON over the private network, called
only by the Next.js server (never a browser directly), at `/api/v1/...`.
**Every request, in this order:** body up to 64 KB → the screens' signature
(`X-Ansa-Timestamp` and `X-Ansa-Signature`: hex HMAC-SHA256 with
SCREENS_SHARED_SECRET of `"<unix seconds>.<METHOD> <path?query>.<body>"`,
within 60 seconds; `SignRequest` makes it; no secret set = every request
refused, 403) → the person's session (the Better Auth cookie forwarded as it
came, see [session](session.md); none = 401 "You're logged out"). The
company always comes from that session, never from the request: a body is
read strictly, and an unknown field (a "companyId") is refused.
**Answers:** JSON; an error is `{"error": "<words for people>"}` with 400,
401, 403, 404, 409 (changed meanwhile) or 429 (a limit).
**Endpoints today:**
- `GET /api/v1/orders`: the Orders page ({open, finished}; see [orders](orders.md)).
- `POST /api/v1/orders/{id}/status` `{"change": "accept" | "ready" | "done" | "cancel"}`:
  anyone in the company (120 changes per 10 minutes per person, the old
  counter); answers `{"notice": ""}` or why the customer wasn't messaged.
**Tests:** `api_test.go` (live database, a real HTTP server): another
secret = 403, no session = 401; the list with the decrypted address and the
lines; accepting messages the customer once with ansa's fixed text; a
second press = 409; an unknown field (a company id) refused.
