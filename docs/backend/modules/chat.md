# chat (core/internal/chat)

**What:** core's ONE door for sending a message to a customer in a chat, and
for recording what became of it.
**Route (`RouteWithin`, inside the transaction that saves the message, the
conversation row locked):** Telegram needs the company's account connected
(not removed), allowed to reply, and the customer's last message under 24
hours old; the development stand-in always routes; calls and emails are not
chats. A refusal (`not-found`, `not-chat`, `not-connected`, `cannot-reply`,
`window-closed`) means nothing is saved. Messenger joins with its module.
**Send (`Sender.Send`):** Telegram through `internal/telegram`; the stand-in
writes a private file (mode 600) to the stand-in folder in development only;
anything not set up fails `not_connected`, never silently.
**Record (`RecordDelivery`):** sent / failed / unclear with a code, only over
`sending`, so a late result never undoes another.
**Tests:** `chat_test.go` (live database).
