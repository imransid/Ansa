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
- Still on the old backend (`links.go` answers 200 and changes nothing): the
  link codes and `business_connection` updates that tie an account to a company.
**Sending (`send.go`):** `Send(token, chatID, text, businessConnectionID)`:
one request with a 15-second limit, no redirects (the token is in the
address); only `ok`, the message id and the HTTP status are read; 429 =
`rate_limited`, 401/404 = `bot_rejected`, other refusals = `refused`; no
answer or a 5xx = `unclear` (Telegram may have it: never sent again by itself).
**Settings:** TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET (all or none).
**Tests:** `update_test.go`; `webhook_test.go` (live database): a wrong or
missing secret saves nothing; a customer message is saved once, encrypted,
with one reply job; the business's own message, the bot's echo and deletions;
`send_test.go`: sent, rate limited, unclear, a wrong token.
