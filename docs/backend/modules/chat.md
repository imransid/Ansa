# chat (core/internal/chat)

**What:** core's ONE door for sending a message to a customer in a chat, and
for recording what became of it.
**Route (`RouteWithin`, inside the transaction that saves the message, the
conversation row locked):** Telegram needs the company's account connected
(not removed), allowed to reply, and the customer's last message under 24
hours old; the development stand-in always routes; calls and emails are not
chats. A refusal (`not-found`, `not-chat`, `not-connected`, `cannot-reply`,
`window-closed`) means nothing is saved. Messenger needs the Page the
customer wrote to connected in this company and allowed to send messages
(`pages_messaging` granted, or a development stand-in), and the same 24
hours. WhatsApp (step 56) needs the number the customer wrote to connected
in this company (not removed on Meta's side), and the same 24 hours.
**Send (`Sender.Send`):** Telegram through `internal/telegram`; Messenger
through `internal/messenger` with the Page's token, read right before by
`internal/social` (a Page that can't be used now fails `not_connected`);
WhatsApp through `internal/whatsapp` with the number's token, read the same
way (`social.WhatsAppToken`); the stand-in
writes a private file (mode 600) to the stand-in folder in development only;
a live call's words (step 55, [phone](phone.md)) are only marked sent: the
phone line speaks them, reading them back from the conversation. Only the
assistant answering that call makes such a target; `RouteWithin` refuses a
phone conversation to everyone else (no chat route: nobody can text a
caller). Anything not set up fails `not_connected`, never silently.
**Record (`RecordDelivery`):** sent / failed / unclear with a code, only over
`sending`, so a late result never undoes another.
**Tests:** `chat_test.go` (live database): Telegram's route; Messenger's
(no Page, a Page for posts only, allowed; nothing sent without ansa's Meta app);
WhatsApp's (no number, removed on Meta's side, connected, a stand-in's file,
past 24 hours).
