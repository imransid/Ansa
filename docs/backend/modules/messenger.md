# messenger (core/internal/messenger)

**What:** the Facebook Messenger channel (the old `services/messenger-*.ts`
and `adapters/messenger.ts`), and the ONLY code in core that talks to
Messenger. A business connects its Facebook Page (the same connection as
posts); Meta sends its customers' messages to `POST /webhooks/messenger`.
**Order of checks (security rule 4):** body up to 512 KB → `X-Hub-Signature-256`
= `"sha256="` + HMAC-SHA256 of the raw body with FACEBOOK_APP_SECRET, in
constant time (no Meta app = every request refused, 401) → the per-IP ceiling
(10,000 a minute) → parse (`events.go`: only ids, mid, text, the first
attachment's kind, is_echo and app_id; ids as digits) → handle. One ansa
can't read is answered 200.
**Setup check (`GET`):** Meta's challenge back only for MESSENGER_VERIFY_TOKEN
(constant time), else 403.
**What it does:**
- The company comes ONLY from the Page id Meta signed, and only when exactly
  ONE company has that Page connected (a cross-company read listed in
  `CROSS_COMPANY.md`; a Page in two companies decides nothing).
- A customer is a Page-scoped id: their contact is `"<page id>:<psid>"`
  (split at the LAST ":", since a stand-in Page's id holds one), so a reply
  goes back through that Page. Their message is saved encrypted once per
  Meta message id (text, or the attachment named: never downloaded), the
  assistant's reply is queued, and so is the name job.
- An echo sent by ansa's own app (its app_id) isn't saved again; any other
  echo is the Page's own message (it stops the assistant's wait).
- The name job (`messenger.name`, `names.go`): the customer's first and last
  name read once from Meta, only while the contact has none (best effort).
**Sending (`send.go`):** the Send API with `messaging_type` RESPONSE and
`appsecret_proof` on every call; a text over 2,000 characters goes as parts
cut at a line break or a space; Meta's 10/2018278 = `reply_window_closed`,
throttling = `rate_limited`, 190 = `not_connected`, other refusals =
`refused`, a 5xx or no answer = `unclear` (never sent again by itself); a
part after the first that fails is `unclear`. Meta's words are never read or
logged (the token is in the address).
**Settings:** FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, MESSENGER_VERIFY_TOKEN.
**Tests:** `messenger_test.go`: events read strictly; long replies in parts,
no word cut or lost; (live database) only Meta's signature lets a message
in, saved once, reply and name queued, the contact id; ansa's own echo
skipped, the Page's own saved, a Page in two companies decides nothing; the
setup check; sending, the window-closed code and the name through a fake
Graph API.
**Still on the old backend:** switching a Page's messages on for ansa's app
after it connects (`subscribed_apps`: with the social connect flow), and
`pnpm simulate:messenger`.
