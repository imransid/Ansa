# packages (core/internal/packages)

**What:** ansa's packages (step 57): what each one costs and includes, in
ONE file (`packages.go`: change a name, a price or a limit there and the
limits, the Billing page and Home follow), which one a company has now,
and its use per calendar month (`usage.go`).

| Package | Price / month | AI replies | Call minutes | Team | Includes |
|---|---|---|---|---|---|
| Free trial (14 days from signup, no card) | $0 | 150 | 15 | 3 | everything in Business |
| Personal | $10 | 300 | 20 | 1 | WhatsApp, Telegram, email |
| Business | $29 | 1,000 | 60 | 3 | + Messenger, orders, "Post for me" up to 3 a week |
| Pro | $79 | 3,000 | 200 | 10 | + "Post for me" every day |

Chosen on 2026-11-03: one AI reply costs ansa about $0.012-0.015 with
Claude Sonnet 5.5 and one call minute about $0.10, so a package pays for
itself even used in full.

**Which package (`Of`):** the paid one while the company's subscription is
live (`company_billing.package`, from the subscription's Stripe price;
active, trialing, past_due while Stripe retries, unpaid, paused), else the
free trial until `companies.trial_ends_at`, else `none`: the trial ended
and nothing was chosen.

**Counting (`usage_months`: company, month = the 1st (UTC), ai_replies,
call_seconds):**
- `TakeAIReply`: one reply written with ansa's AI, counted in ONE statement
  only while the month has one left (two at once never pass the limit).
  Counted: the assistant's chat replies (`assistant.packageRefusal`), every
  email the AI reads (`inbound`), every "Post for me" post (`autopost`).
  Not counted: replies written with the business's own Claude key, "Try
  your assistant", calls (their minutes count instead) and the hidden
  marketing pages (their own hourly limits).
- Call minutes: each call's length is added when it ends (in the
  transaction that ends it: once); a turn checks the month's finished
  calls plus the live call so far (`CallTimeLeft`).
- Team members: people with a login plus pending invites
  (`TeamSeatLeftWithin`, in the invite's transaction; two invites at the
  very same moment can pass by one).

**At a limit ansa never goes silent:** a chat gets the holding reply and a
request (reason `package_used_up`; a channel the package doesn't include,
Messenger on Personal: `not_in_package`), the AI not asked; a call takes
the message with fixed words; an email still becomes a request, without
the AI; a post is skipped (`package`). Orders come only with packages that
include them (otherwise the assistant hands an order to a person). Home
tells owners (the free trial's days and end, replies at 80% and used up,
no call minutes left), and Billing shows the package, this month's use and
the packages to choose.

**Tests:** `packages_test.go` (the trial, then nothing until a package is
paid, kept while Stripe retries; AI replies stop at the limit, a new month
starts again; call minutes count finished calls and the live one; team
seats count pending invites; posting frequencies). Also
`assistant/package_limits_test.go`, `phone/handover_test.go`,
`teammates`, `billing` and `api/billing_test.go`.
