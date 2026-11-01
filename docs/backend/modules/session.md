# session (core/internal/session)

**What:** who is making a request to core's API: the ONLY trusted source of a
company in core (the old `lib/session-context.ts`). Core reads the same login
the screens make today: Better Auth's session cookie and its row in the
`sessions` table.
**Rules:**
- The cookie `__Secure-better-auth.session_token` (https) or
  `better-auth.session_token` holds `<token>.<base64 HMAC-SHA256(BETTER_AUTH_SECRET, token)>`,
  URL-encoded (better-call's `signCookieValue`); the signature is checked in
  constant time. Tested against a value better-call 1.4.2 made itself.
- The session must be unexpired, and its person not removed
  (`deactivated_at` empty): a removed teammate is logged out on their next
  request, whatever happened to their sessions. A malformed row counts as
  logged out.
- The token names one person; their own company is then the only one used
  (a cross-company read by token, listed in `CROSS_COMPANY.md`).
**When core takes over logins (phase 6):** the same cookie and table, so
nobody is logged out by the switch.
**Tests:** `session_test.go`: Better Auth's own signature; another secret and
an unsigned value refused; (live database) a live session reads its person
and company, under both cookie names; a changed signature, a removed person
and an expired session are logged out.
