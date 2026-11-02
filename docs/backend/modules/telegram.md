# telegram (core/internal/telegram)

**What:** the Telegram Business channel. A business adds ansa's one bot to
its own Telegram account as a chatbot; customers write to the business as
always, and Telegram passes the messages to `POST /webhooks/telegram`.
**Order of checks (security rule 4):** body up to 256 KB → the
`X-Telegram-Bot-Api-Secret-Token` header equal to TELEGRAM_WEBHOOK_SECRET
(constant time; no secret set = every request refused, 401) → the per-IP
ceiling (10,000 a minute: every business's messages come from Telegram's few
addresses) → parse (`update.go`, only the fields ansa reads, ids as safe
integers, texts capped) → handle. An update ansa can't read is answered 200.
**What it does:**
- A customer's message (`business_message`) is saved encrypted in their
  conversation, once per Telegram message id, and a job `assistant.reply` is
  queued once for it.
- A message the business wrote in its own Telegram app is saved as the
  business's own and stops the assistant's wait.
- ansa's own reply coming back (`sender_business_bot`) isn't saved again.
- Messages deleted in Telegram are deleted in ansa.
- The company comes ONLY from the business connection id (a cross-company
  read listed in `CROSS_COMPANY.md`).
- Connecting (`links.go`, `linkstore.go`, `linking.go`): an owner's
  "Connect Telegram" makes a one-time code (32 random bytes; only its
  SHA-256 is stored; 10 minutes). The owner's `/start <code>` in the bot's own
  chat CLAIMS it in one UPDATE with their Telegram user id (at most 10
  messages to the bot per user per 10 minutes). The chatbot that same user
  adds in Telegram (a `business_connection` within the hour) is then tied to
  the code's company in ONE transaction: the company row lock first, the
  code's maker read again (still a confirmed, active owner), the code locked
  and unused. A chatbot added before the Start waits an hour in
  `telegram_pending_connections` (Telegram's ids and the name only; it
  belongs to no company) and the Start ties it. An account tied to another
  company is refused; a company's account removed in Telegram is replaced.
  Later `business_connection` updates set the status (removed, added back,
  reply permission, name). The bot tells the owner what happened in its own
  chat (fixed notes, sent after the answer, best effort). The code goes from
  ansa to Telegram, never back: a leaked code can at worst tie the leaker's
  own account to the owner's company, never take a business's chats.
**Sending (`send.go`):** `Send(token, chatID, text, businessConnectionID)`:
one request with a 15-second limit, no redirects (the token is in the
address); only `ok`, the message id and the HTTP status are read; 429 =
`rate_limited`, 401/404 = `bot_rejected`, other refusals = `refused`; no
answer or a 5xx = `unclear` (Telegram may have it: never sent again by itself).
**The bot's own setup (`botapi.go`):** `SetWebhook` (core's address, the
secret as `secret_token`, the four kinds of updates ansa reads in
`UpdateTypes`, 40 connections) and `DeleteWebhook`, for the operator's
`telegram-webhook`; `GetUpdates` (25-second long polls; 409 = a webhook is
set) for the development `telegram-poll`, which hands each update to this
webhook's handler in its own process ([commands](commands.md)). Read by
status, `ok` and the updates only, never Telegram's own words.
**Settings:** TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET (all or none).
**Tests:** `update_test.go`; `webhook_test.go` (live database): a wrong or
missing secret saves nothing; a customer message is saved once, encrypted,
with one reply job; the business's own message, the bot's echo and deletions;
`send_test.go`: sent, rate limited, unclear, a wrong token; `links_test.go`
(live database): Start then chatbot connects the code's company, once; a
chatbot added first waits for the Start; a stranger is told how to connect;
a made-up code connects nothing; an owner made a member meanwhile connects
nothing; `botapi_test.go` (a fake Bot API; refused while TELEGRAM_BOT_TOKEN
is set): the webhook's address, secret and updates, refusals by status, the
updates read and a webhook that stops polling.
**Making the code** (the "Connect Telegram" button) is
[channels](channels.md)'s; this package claims and uses it (`linkstore.go`).
