# inbox (core/internal/inbox)

**What:** the Inbox (the old `services/conversations.ts`,
`services/conversation-page.ts`, `services/assistant-drafts.ts`,
`db/conversations.ts`, `db/conversation-writes.ts`): one company's
conversations, one conversation's page, and a person's work in it. Everyone
in the company works conversations, as they work tickets.
**Reading:**
- `List` (views "needs-you" and "all", 50 a page, at most 10,000 pages):
  "Needs you" = an open request in the conversation OR a reply of the
  assistant waiting for a person (Home counts with the same condition);
  newest activity first; each with a one-line preview of its newest entry
  (a customer's words, "ansa: ...", "You: ...", "Phone call", "Email";
  decrypted, one plain line, 120 characters) and its newest open request.
  `Counts` per view.
- `ReadPage`: the conversation and its contact (important or not, who took
  it over), its newest 200 entries oldest first (chat messages decrypted;
  calls and emails as links, an email's subject decrypted), its open
  requests, its newest 20 activity lines, the customer's newest 3 placed
  orders, and whether a reply can go now (the same rules a reply checks,
  `chat.RouteWithin`, read without writing).
- `ListActivity`: a conversation's lines, or ansa's own newest work (Home's
  "What ansa did"); never a message's text.
**Changing (each in ONE transaction that reads the person again,
`team.RoleWithin`: confirmed, not removed, FOR SHARE):**
- `TakeOver` / `HandBack` (an activity line with who; doing it twice is
  "unchanged"); `SetImportant` (ansa never answers an important person itself).
- `Replies.Reply`: a person's reply (1-4,000 characters, a line break counted
  once, no control characters) saved "sending" encrypted, then sent through
  the chat door and recorded. Replying takes the conversation over when ansa
  had it and ends ansa's wait to step in; an edit of the assistant's waiting
  reply discards it in the same transaction. A reply that can't go now
  (not a chat, not connected, not allowed, past 24 hours) saves nothing.
- `Replies.SendDraft` (as the assistant wrote it; the conversation isn't
  taken over) and `DiscardDraft` (kept as "discarded"): only while it still
  waits.
**API:** `GET /api/v1/inbox?view=&page=`, `GET /api/v1/activity`,
`GET /api/v1/conversations/{id}`, `POST .../take-over`, `.../hand-back`,
`.../important {"important": bool}`, `.../reply {"text", "replacesDraftId"}`,
`.../drafts/{message}/send`, `.../drafts/{message}/discard` (120 changes per
10 minutes per person, the old counter).
**Tests:** `api/inbox_test.go` (live database): a waiting reply is "Needs
you" with ansa's preview; the page decrypted and replyable; Send then
Discard (already sent = 409); an empty reply refused with its words; a
reply goes out and takes the conversation over; hand back; important;
another company's conversation = 404; what ansa did.
**Still on the old backend:** the request's actions on the page (assign,
Done, notes): they move with tickets (phase 5).
