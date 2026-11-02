# billing (core/internal/billing)

**What:** Billing (the old `services/billing.ts`, `services/stripe-webhook.ts`,
`db/billing.ts`, `adapters/stripe.ts`): one subscription per company,
kept as Stripe has it, written ONLY from Stripe's signed webhooks (or the
development stand-in), never from what a browser sends. It records who
pays and enforces nothing yet: packages, limits and what happens when a
payment fails are the owner's decision (build step 57).

**Stripe (`stripe.go`):** its REST API over HTTPS, no SDK: the secret key
as Basic auth, the old library's API version pinned (`2026-09-30.endive`),
20 s per call; Stripe's words are never kept or logged. `CheckoutURL` (the
plan STRIPE_PRICE_ID; the company id put in client_reference_id AND the
subscription's metadata, both signed back by Stripe; a company that paid
before keeps its one Stripe customer), `PortalURL` (change card, invoices,
cancel), `Subscription` (Stripe's state NOW: events can arrive late or out
of order). Card details never touch ansa: customers type them on Stripe's
pages.

**The webhook (`webhook.go`, `POST /webhooks/stripe`):** the order every
webhook keeps: at most 256 KB, raw bytes, Stripe's signature (`t=...,v1=...`:
HMAC-SHA256 of "<t>.<body>" with STRIPE_WEBHOOK_SECRET, made in the last 5
minutes, compared in constant time; no secret = every request refused),
600 a minute per IP, then JSON. Only `checkout.session.completed` and
`customer.subscription.created / updated / deleted` matter; the
subscription is read from Stripe again and stored for its company by the
old rules: only a finished checkout gives a company its first row (an
event about a customer no company owns yet is ignored: its metadata alone
could name any company); the checkout and the metadata disagreeing stores
nothing; later events go to the company that owns the customer, never to
another; a second live subscription for a company that has one is not
stored (logged: "company already has another live subscription"; a
person cancels it in Stripe). A different subscription replaces the stored
one only when that one is no longer live. 500 only when Stripe didn't
answer (it tries again).

**The page (`page.go`):** modes "stripe" (USE_STRIPE=true), "dev" (a
developer's machine: simulate buttons, nothing charged) and "off"
(production without Stripe: "Billing isn't set up yet", never developer
wording). Owners only (members get nothing); Subscribe is offered only with
no live plan and no payment being confirmed (back from Stripe before its
webhook arrived), so nobody pays twice.

**API ([api](api.md)):** `GET /api/v1/billing?checkout=done`; `POST
/api/v1/billing/checkout` → `{"url"}`; `POST /api/v1/billing/portal` →
`{"url"}`; `POST /api/v1/billing/simulate` `{status: active | past_due |
canceled}` (dev only). 20 actions per 10 minutes per owner.

**Settings ([config](config.md)):** USE_STRIPE (exactly "true"), then
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID are required.

**Tests:** `billing_test.go` (only Stripe's fresh signature on these bytes
counts; billing never moves between companies; a subscription event before
any checkout stores nothing, the checkout stores the plan, a second live
plan never replaces it; the page and the simulate buttons).
