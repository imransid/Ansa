# devmail (core/internal/devmail)

**What:** the development mailbox (for trying and showing ansa on the laptop:
[../../demo.md](../../demo.md)). In development every email ansa sends is an
HTML page in `.dev-emails/` ([email](email.md)): this reads them back, so the
emails can be opened in the app instead of the folder.

**Rules:**
- Only an email's From, To, Subject and plain text are read, never its HTML.
  At most the newest 2,000 files are looked at (the folder only grows).
- An owner sees the emails sent **for their company**: each file is named by
  its send's idempotency key, which names its records
  (`ticket-solved-<outgoing email id>`, `ticket-assigned-<job id>`,
  `needs-you-<job id>-<owner id>`, `new-order-<order id>-<owner id>`,
  `verify-email-<user id>-...`, `reset-password-...`,
  `existing-account-...`); an email shows when one of those ids is one of
  the company's people, customer emails or assignment jobs (`OfCompany`).
  So another company's emails, and those of an earlier demo reset (other
  ids), never show, even to the same address.
- Before a login (the "check your email" and "forgot password" pages), the
  newest email to an address the visitor types (`ToAddress`): the pages a
  rehearsal's signup or reset needs. No login, so only for made-up
  addresses no real inbox has (`@demo.ansa.test`, any `.test`, `.example`,
  `.invalid` or `.localhost` domain, `example.com/.net/.org`: a real
  account's reset link is never shown this way), limited (60 looks per 10
  minutes per IP), and only ever on a development server, whose screens
  listen on this computer only (`pnpm dev` binds 127.0.0.1).
- Production, or real email on: the API has no folder and refuses
  (`DevMailFolder` is "", `cmd/core/wiring.go`).

**API** (`internal/api/dev_mailbox.go`): `GET /api/v1/dev/mailbox` (owners:
`{available, emails}`, the newest 50), `POST /api/v1/dev/mailbox/newest`
(`{email}`: `{email: the newest or null}`).

**Screens:** Settings → Connections → Development mailbox
(`app/settings/channels/mailbox/`); `components/dev-mail-peek.tsx` on the
check-email and forgot-password pages (hidden in a production build). Links
to this computer in an email's text are clickable.

**Tests:** `internal/devmail/devmail_test.go` (newest first, read as
written, only the emails kept, a key's ids), `internal/api/dev_mailbox_test.go`
(an owner sees their company's emails only, not an earlier reset's to the
same address; the newest before a login, never to a real inbox's address;
members and real email refused).
