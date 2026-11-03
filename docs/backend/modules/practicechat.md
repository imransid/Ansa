# practicechat (core/internal/practicechat)

**What:** the development practice chat (step 58, for demos: [../../demo.md](../../demo.md)).
An owner writes as a made-up customer on WhatsApp, Telegram or Messenger
through the company's stand-in account (Settings → Connections), and reads
the chat as that customer sees it. The demo's customer side, in the browser,
beside the owner's own pages.

**Rules:**
- A message is saved as each channel's own code saves a customer's:
  `conversations.InsertCustomerMessage` in the customer's conversation,
  encrypted, the assistant's reply queued (as the simulate tools do). So the
  assistant, orders, requests, alerts and "While you were away" work exactly
  as for a real customer.
- The made-up customer is named by `internal/standins` (shared with the
  simulate tools): the same name is the same customer, so a conversation
  goes on where it was; `Find` shows it again after a reload.
- The chat shows what reached the customer: their messages, and replies sent
  (or being sent, or unclear), never a reply waiting for the owner's approval
  ("Ask me first") or one discarded.
- Without a stand-in account on that channel: refused (409), the page links
  Connections.

**API** (`internal/api/practice_chat.go`, owners only, refused on a
production server): `GET /api/v1/practice/chat` (available, which channels
have a stand-in), `POST /api/v1/practice/chat` {channel, name, text}
(checked: a known channel, a name of 1-100, a message of 1-4,000; 300 an
hour per company), `GET /api/v1/practice/chat/find?channel=&name=`,
`GET /api/v1/practice/chat/{id}` (the company's own conversations only).

**Screens:** `app/settings/channels/practice-chat/` (the page polls every
2 seconds while a chat is open, so an order accepted on the Orders page
shows in the customer's chat).

**Tests:** `internal/api/practice_chat_test.go` (a stand-in needed, the
reply queued as for any customer, the same name the same customer, found
again, never a draft shown, fields checked, another company's chat not
there, members and production refused); `internal/standins/customers_test.go`.
