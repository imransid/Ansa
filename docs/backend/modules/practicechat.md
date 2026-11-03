# practicechat (core/internal/practicechat)

**What:** the development practice chat (step 58, for demos: [../../demo.md](../../demo.md)).
An owner writes as a made-up customer on WhatsApp, Telegram or Messenger
through the company's stand-in account (Settings → Connections), and reads
the chat as that customer sees it; or sends an email as one, to the
company's forwarding address ([email-in](email-in.md)). The demo's customer
side, in the browser, beside the owner's own pages.

**Rules:**
- A message is saved as each channel's own code saves a customer's:
  `conversations.InsertCustomerMessage` in the customer's conversation,
  encrypted, the assistant's reply queued (as the simulate tools do). So the
  assistant, orders, requests, alerts and "While you were away" work exactly
  as for a real customer.
- The made-up customer is named by `internal/standins` (shared with the
  simulate tools): the same name is the same customer, so a conversation
  goes on where it was; `Find` shows it again after a reload. A name without
  Latin letters or digits (Bangla, Arabic) is a number from the name's hash
  on Messenger and WhatsApp too, as on Telegram, so two such names are two
  customers; a Latin name keeps the id it always had.
- **Answer as the business, from its own app** (`business.go`, a tick on
  the page): the text is saved as the business's own message, as if written
  in its own app, through each channel's own path for one: Telegram, a
  business message from the stand-in account's own user handed to core's
  Telegram update handling (`telegram.Webhook.HandleUpdate`); WhatsApp, an
  echo of the WhatsApp Business app (`whatsapp.SaveEvent` with `KindEcho`);
  Messenger, the Page's own message (`messenger.SavePagesOwnMessage`). So
  "Written in Telegram" (and the others) show in the Inbox, and ansa steps
  back as for a real one ([conversations](conversations.md): taken over
  with "Always", until Hand back). The customer writes first: refused (409)
  before their first message.
- The chat shows what reached the customer: their messages, and replies sent
  (or being sent, or unclear) and the business's own on the business's
  side, never a reply waiting for the owner's approval ("Ask me first") or
  one discarded.
- With the chat, what ansa does next with the customer's newest message
  (`assistant.WhatNext`, read with the assistant's own gate and away
  settings, nothing written): "answers" (now; an important person passed
  on), "answers_at" (it waits for you until `at`: "if I haven't answered
  within N minutes"), "draft" (Ask me first), or why it stays quiet:
  "paused", "taken_over", "request_open", "told_you" (an important person
  while their request is open: you were alerted), "you_answer" (Only when
  I'm away, and you're available), "nothing" (it needed no answer). The
  page shows "ansa is writing..." only for "answers".
- Without a stand-in account on that channel: refused (409), the page links
  Connections.
- **Email** (`email.go`): the owner writes an email as a customer (a name or
  none, an address, a subject, the text, and whether Resend reported DKIM or
  DMARC passed). It arrives as a forwarded email does: its content in
  `<ANSA_DEV_FOLDER>/.dev-inbound/<id>.json` (`resend.WriteDevInbound`, where
  core's development fetcher reads it, in the shape of Resend's Receiving
  API: `from` the bare address, the name only in `headers.from`), addressed
  to the company's forwarding address, then saved and its processing queued
  by `resend.SaveAndQueue`, the webhook's own last step (no signature, no
  HTTP round trip: the company is the session's). Core's worker then reads it
  as any received email: the filters (10 an hour per sender, as for real
  ones), the AI's triage, the request and the sender's conversation (a
  verified sender becomes the customer; otherwise only suggested). ansa
  never answers an email. Refused (409) while real email is on
  (SEND_REAL_EMAIL): core would ask Resend for it.

- **A comment** on the stand-in Facebook Page's posts (the practice
  comment box, [comments](comments.md) `practice.go`): the owner writes as a
  made-up person under one of the Page's newest published posts (or ansa's
  fixed stand-in post when it has none); saved through the same path as a
  comment from Meta's webhook (`comments.Save`), the commenter named by
  `standins.PSID(name)`, so a private message ansa sends them shows in the
  practice chat's Messenger chat for the same name, and their answer there
  continues it.

**API** (`internal/api/practice_chat.go`, `practice_email.go`, owners only,
refused on a production server): `GET /api/v1/practice/chat` (available,
which channels have a stand-in, whether the practice email works here),
`POST /api/v1/practice/chat` {channel, name, text, asBusiness}
(checked: a known channel, a name of 1-100, a message of 1-4,000; 300 an
hour per company; asBusiness: the business's own answer, 409 before the
customer wrote), `GET /api/v1/practice/chat/find?channel=&name=`,
`GET /api/v1/practice/chat/{id}` {lines, next: {what, at}} (the company's
own conversations only),
`POST /api/v1/practice/email` {name, address, subject, text, verified}:
{to} (body up to 1 MB; checked: a name of 0-100 and a subject of 1-1,000,
each one plain line, the address by the customer address rule, the text a
box of 1-100,000; 100 an hour per company);
`GET /api/v1/practice/comment/posts`, `POST /api/v1/practice/comment`
{postId, name, text}: {commentId}, `GET /api/v1/practice/comment/{commentId}`
(the comment and `next`: "answering" | "done"), described in
[comments](comments.md) (`internal/api/practice_comments.go`).

**Screens:** `app/settings/channels/practice-chat/` (while a chat is open
the page looks at it again 2 seconds after each look ended, so an order
accepted on the Orders page shows in the customer's chat: never two looks
at once, none while a message is being sent, and a send doesn't wait for
an extra look (server actions run one at a time per browser, so piled-up
looks once held a send for minutes on a busy laptop); a sent message shows
at once, and the next look brings the chat as core has it. Below the
customer's newest message, "ansa is writing..." only while `next` says
ansa answers, else a line for the presenter saying why it doesn't, or when
it answers. Who writes is `who-writes.tsx`; the message box and its
"Answer as the business" tick are `message-form.tsx`; for one person every
word is a person's ("Who writes, and on which app", "Their name", "Answer
as yourself, from your own app"); "Email" shows `practice-email.tsx`
instead, which says where the email went and links the Inbox and the
Emails page). Settings → Connections links it in each stand-in's advice.

**Tests:** `internal/api/comments_test.go` (the practice comment: the
fixed post, a stand-in Page needed, saved and answered as Meta's, read back,
fields checked, production refused); `internal/api/practice_chat_test.go` (a stand-in needed, the
reply queued as for any customer, ansa said to answer it, the same name the same customer, found
again, never a draft shown, fields checked, another company's chat not
there, members and production refused; answering as the business on each
channel: not before the customer wrote, saved as the business's own in
their conversation, shown on the business's side, ansa stepping back until
Hand back); `internal/api/practice_email_test.go`
(the email saved as received and its job queued for this company only, its
content where the development fetcher reads it, fields checked, an unknown
one refused, refused while real email is on, members and production
refused; run by core's worker, a verified sender becomes the request's
customer, an unverified one only suggested); `internal/standins/customers_test.go`;
`internal/assistant/next_test.go` (what ansa does next follows the gate
and the away settings: answers, answered, a request open, an important
person told, Ask me first, paused, waiting until its time before and
after the run set it, left to you, taken over).
