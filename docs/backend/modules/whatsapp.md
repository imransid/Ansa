# whatsapp (core/internal/whatsapp)

**What:** WhatsApp Business (step 56). A company connects its WhatsApp
number through Meta's official Cloud API, and its customers' WhatsApp
messages reach the Inbox, answered by the same assistant as every chat
([assistant](assistant.md): checks, orders, handovers, "Only when I'm
away"). The business may keep using the **WhatsApp Business app** on its
phone with the same number (Meta's "coexistence"): what it writes there
reaches ansa as an echo, so ansa knows it answered. A personal WhatsApp
number can't be connected: WhatsApp allows no assistant on one. This
package is the ONLY code that talks to WhatsApp.

**Connecting (`connect.go`, `signup.go`; Settings → Connections; owners):**
"Connect WhatsApp" opens Meta's own sign-up window (Embedded Signup, with
the WhatsApp Business app's number allowed:
`featureType: whatsapp_business_app_onboarding`). The window reports a
one-time code (it works for 30 seconds) and the business account and
number chosen; the page hands them to core at once
(`POST /api/v1/channels/whatsapp/connect`). They are the browser's claims
until Meta confirms them, server to server (`Confirm`): the code exchanged
for the business's token; the token ansa's app's, valid, and granted
`whatsapp_business_messaging` for that business account (`debug_token`);
the number among the account's, with Meta's own word on whether the
WhatsApp Business app uses it (`is_on_biz_app`: never the browser's);
ansa's app subscribed to the account's webhooks (`subscribed_apps`); a
number not shared with the app registered for the Cloud API with a new
random six-digit PIN (its two-step verification PIN; ansa never keeps it,
the business can change it in WhatsApp Manager). Before asking Meta, core
checks the person is an active owner and the company has no number yet;
then the number is saved in ONE transaction that takes the company row
lock and reads the role again (`settings.AsOwner`), its token encrypted
(`social.WhatsAppTokenContext`: company and number). One number per
company; a number connected in another company is refused by the
database's own rule. Disconnect (owners, a confirm) deletes the token; the
row stays as history. Nothing past chats or the app's contact book is
imported.

**Messages (`webhook.go`, `events.go`, `message_text.go`):**
`POST /webhooks/whatsapp`, in the project's order: size cap (512 KB), raw
bytes, Meta's signature (`X-Hub-Signature-256`, HMAC-SHA256 of the body
with `FACEBOOK_APP_SECRET`, constant time; the same as Messenger's), the
per-IP limit (`whatsapp-webhook`, a ceiling: all of it comes from Meta),
then the body read strictly (anything odd in what ansa reads = ignored with
200, as Meta would send it again and again). The company comes ONLY from
what Meta signed: the phone number id, and only when exactly one company
has that number connected (a cross-company read, listed in
`CROSS_COMPANY.md`). A customer is "<phone number id>:<customer id>": their
business-scoped user id ("US.1349...", in every message since April 2026;
someone with a WhatsApp username may hide their number), else their
number's digits. Text, a button's or a list's choice and a caption are
kept; a photo, voice message, video, file, sticker, location or contact
card is named ("[A voice message: open WhatsApp to see it]"), never
downloaded; reactions and WhatsApp's own notices are left out. Saved once
per WhatsApp message id, encrypted, with the assistant's answer queued
(`conversations.InsertCustomerMessage`). An echo (`smb_message_echoes`) is
the business's own message: author `business_account` ("Written in the
WhatsApp Business app"), and the assistant stops waiting to step in. An
`account_update` (`PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED`) marks the
business account's numbers `removed_in_whatsapp` (nothing arrives or goes;
the token kept), `ACCOUNT_RECONNECTED` connects them again; a number an
owner disconnected stays disconnected. Statuses (delivered, read) and
other fields are left out. `GET /webhooks/whatsapp` answers Meta's setup
check with its challenge only for `WHATSAPP_VERIFY_TOKEN`.

**Replies (`send.go`, through [chat](chat.md)):** `chat.RouteWithin` needs
the number the customer wrote to connected in this company and the
customer's last message under 24 hours (Meta's rule); the token is read
right before sending by `social.WhatsAppToken` (core/internal/social is the
only code that decrypts a token). The message goes to
`/<phone number id>/messages` with the token in the Authorization header
(never in an address) and `appsecret_proof`; a business-scoped id as
`recipient`, a number as `to`; at most 4,096 characters. Meta's refusals
become codes (131047 = `reply_window_closed`, 130429 / 131056 / 80007 / 4 =
`rate_limited`, 190 / 133010 = `not_connected`, others `refused`); no
answer or a 5xx = `unclear`, never sent again by itself.

**Modes (`Connector.Mode`):** "real" with `FACEBOOK_APP_ID`,
`FACEBOOK_APP_SECRET` and `WHATSAPP_SIGNUP_CONFIG_ID` (the id of a Facebook
Login for Business configuration made for WhatsApp Embedded Signup);
"stand-in" in development without them (a stand-in number: its customers
come from `make simulate-whatsapp`, replies are files in `.dev-messages/`);
"not-set-up" in production without them.

**Table `whatsapp_numbers`** (migration 0050): company, business account
and phone number ids (digits, or `stand-in:` for the stand-in), the number
and the business's name as Meta gives them, `shared_with_app`, the token
(encrypted; CHECK: a real number in use has one, a stand-in or a
disconnected number has none), status connected / removed_in_whatsapp /
disconnected, who connected it (same-company foreign key). One live number
per company, and per number (partial unique indexes).

**Tests:** `events_test.go` (a customer's own id, names, what is kept of
each kind of message; echoes, account changes, odd bodies refused),
`send_test.go` (a fake Graph: the token in a header, `recipient` or `to`,
refusals as codes), `signup_test.go` (Meta confirms every claim before
anything is saved, each refusal; owners only, one number per company,
another company's number refused, the token encrypted and gone on
disconnect; the stand-in), `webhook_test.go` (Meta's signature, once per
message id, the name, the reply queued; an echo stops the assistant
waiting; Meta ending and restoring the link; the setup check). Also
`internal/chat` (the route), `internal/api/channels_test.go` (the
endpoints) and `cmd/simulate` (the stand-in).

**Not confirmed (nothing has met Meta yet):** the shape of
`smb_message_echoes` for a customer known only by a business-scoped id
(ansa reads `to_user_id`, else `to`), whether Meta reports `is_on_biz_app`
in the number list as on the number itself, and the exact
`debug_token` answer for a business token (ansa needs
`whatsapp_business_messaging` with the business account among its
`target_ids`).
