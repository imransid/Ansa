# httpserver (core/internal/httpserver)

**What:** core's HTTP server with the protections every route gets.
**Rules:** time limits (header 5 s, read 15 s, write 30 s; slow work runs as a
job after the answer); security headers on every answer (nosniff, no frames,
no referrer, no-store); a panic answers 500 with one safe log line;
`ReadBody` caps a body before anything reads it (413). `ClientIP` is the
caller's address for per-IP rate limits, the same as the old
`lib/request-ip.ts` so both backends count together: X-Forwarded-For's first
entry, else X-Real-IP, else the connection's address; an IPv6 address counts
as its /64 network.
**Routes today:** `GET /health` (200, no body), `POST /webhooks/telegram`,
`POST` and `GET /webhooks/messenger`.
**Tests:** `httpserver_test.go`.
