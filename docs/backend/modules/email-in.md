# email in (core/internal/resend, core/internal/inbound, brain/brain/email)

**What:** customer emails become requests (the old
`services/inbound-email-*.ts`, `db/inbound-email-processing.ts`,
`lib/email-triage/`). The AI only triages: it never writes or sends replies
to emails.
**The webhook (`POST /webhooks/resend`), in this order:** body up to 256 KB →
Resend's Standard Webhooks signature (`svix-id`, `svix-timestamp`,
`svix-signature`: HMAC-SHA256 with RESEND_WEBHOOK_SECRET over
`"<id>.<timestamp>.<body>"`, constant time, within 5 minutes; no secret =
every request refused) → the per-IP ceiling (600 a minute) → parse.
- Delivery problems of emails ansa sent (bounced, complained, suppressed,
  failed) are recorded on that email (by Resend's id, the first one wins).
- A received email: the company comes ONLY from a forwarding address ansa
  made (`c-<token>@INBOUND_EMAIL_DOMAIN`, read in to, cc, bcc and
  received_for: safe because nobody else can make one), and only when
  exactly ONE company matches; the email is saved once (Resend's id is
  unique) and its processing job queued in the same transaction.
**Processing (the `inbound_email.process` job, `inbound/process.go`):**
claim in ONE UPDATE (new, or "processing" 15+ minutes: a cut-off run) →
fetch the content (Resend's Receiving API, three tries on 429, 5xx or no
answer, 20 s each; in development `.dev-inbound/<id>.json`) → never ansa's
own addresses (a loop: not even "anyway") → the filters (the company's own
support address unless its Google Group passes on a customer, automatic
replies, bulk mail, bounces, 10 an hour per sender) → the brain's triage
(100 an hour per company, else the email's own subject) → ONE transaction
while the email is still claimed: the request (routed like every new one),
the email encrypted (subject, body, attachment names), and the sender's
conversation. Whatever fails after the content arrived still saves one
fallback request.
**The sender (`inbound/sender.go`):** filled in as the customer ONLY when
Resend's own DKIM or DMARC passed (never SPF alone, never a header anyone
can write), every From text holds exactly one "@" and names the same
address, the From wasn't cut, and there is no other Reply-To (a contact
form's relay) and it isn't one of the company's addresses. Otherwise a
person confirms it; the conversation is kept apart ("unverified:...") so a
forged From never joins a real customer's.
**Content (`inbound/content.go`, `htmltext.go`):** subject up to 1,000,
body up to 100,000 (the cut marked); text made from HTML when there is no
plain part (a forward-only scanner: hostile HTML takes time in proportion to
its length); attachments counted and named, never stored; pictures the HTML
shows inside counted apart.
**The brain's triage (`POST /v1/email/triage`):** only what the customer
wrote this time (quoted replies, Outlook headers, forwards and the "-- "
signature cut, in several languages; a bare forward kept whole), card and
social-security numbers and email addresses hidden, angle brackets replaced,
at most 6,000 characters; answers a summary, a subject (under 80) and one of
the company's categories exactly, or why not.
**The Emails page:** `GET /api/v1/emails?page=` (who, when, what became of
it, stuck or not; never the content); `POST .../{id}/process-again` and
`.../{id}/ticket-anyway` (never for ansa's own mail).
**Settings:** RESEND_WEBHOOK_SECRET; SEND_REAL_EMAIL, RESEND_API_KEY and
INBOUND_EMAIL_DOMAIN as for email out.
**Tests:** `resend_test.go` (the signature: changed body, old event, another
secret; only ansa's forwarding addresses); `inbound_test.go` (live
database, a fake brain: a verified sender becomes the customer and joins
their conversation, a card number never reaches the subject; a forged sender
is never filled in; ansa's own mail is a loop even "anyway"; an automatic
reply is skipped, then made a request anyway; content unavailable; HTML read
as text); `brain/tests/test_email.py` (the customer's own words; secrets and
tags hidden; the answer strict).
**Still to move:** the scheduled run of stuck emails (with the maintenance
job), the "not delivered" list.
