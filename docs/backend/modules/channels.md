# channels (core/internal/channels)

**What:** Settings → Connections (the old `services/telegram-connect.ts` and
the Connections page's reads): where people reach the company.
**Reading (`GET /api/v1/channels`, everyone):** the company's Telegram
account (its name, status, whether it is the development stand-in; nothing
once disconnected), its Facebook Pages and whether each one's messages come
to ansa (`pages_messaging` and `pages_manage_metadata` granted, as the
old page said), its forwarding address
(`c-<companies.inbound_token>@INBOUND_EMAIL_DOMAIN`) and when the last
email reached it, ansa's phone numbers linked to it with each one's last
call, and Telegram's mode ("real" with ansa's bot, "stand-in" in
development without it, "not-set-up" in production without it), and
Facebook's the same way (ansa's Meta app), each Page with its connection id;
the WhatsApp number (step 56: the number, the business's name, its status,
whether the WhatsApp Business app shares it, a stand-in or not), WhatsApp's
mode and, only in "real", what the page needs to open Meta's sign-up window
(the app id and the configuration id). Connecting WhatsApp: [whatsapp](whatsapp.md).
**Owners (60 settings changes per 10 minutes):**
- `POST /api/v1/channels/telegram/link`: a one-time code (32 random bytes,
  43 characters; only its SHA-256 is stored, 10 minutes) in a link to ansa's
  bot, `https://t.me/<bot>?start=<code>`. The owner's Start and the chatbot
  they add then connect the account ([telegram](telegram.md)).
- `.../stand-in`: development without ansa's bot only, one account.
- `.../disconnect`: messages and replies stop; the row stays as history;
  connecting again needs a new link.
**Settings:** INBOUND_EMAIL_DOMAIN (required with real email; never change
it once companies forward to it).
**Tests:** `api/channels_test.go` (live database): the page and the
forwarding address; no link without a bot; one stand-in account; disconnect;
a link with a 43-character code whose hash is kept for 10 minutes.
**Connecting Facebook Pages and other social accounts** (OAuth):
[socialconnect](socialconnect.md).
**Screens:** `app/settings/channels/`. Each chat channel says what ansa does
when the business answers in its own app, with "Always" and with "Only when
I'm away" (`own-answers.tsx`, [conversations](conversations.md)). A
development stand-in is marked once ("Development stand-in") and its advice
links the practice chat (`stand-in.tsx`). A Facebook Page has its own
Disconnect there; a stand-in Page, LinkedIn, X or YouTube stand-in is
offered only while none is connected; connecting a stand-in or
disconnecting brings the owner back to Connections (the form's hidden
`from`: `app/actions/social-accounts.ts`). A real platform's consent screen
still returns to the Accounts page, which explains its result.
