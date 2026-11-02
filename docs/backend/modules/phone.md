# phone (core/internal/phone)

**What:** calls answered live (step 55). Someone who couldn't reach the
person or the business talks with ansa, turn by turn, and ansa answers with
the SAME assistant as chats ([assistant](assistant.md)): the business's or
the person's details, menu, saved answers and instructions, core's checks,
orders priced by ansa, handovers with a request and the owners' alert. The
call is the caller's conversation (a contact on channel `phone`, by their
number's digits): their words and ansa's are its messages, encrypted, so the
Inbox and "While you were away" show it like a chat.

**The one door for every phone line (`phone.go`):** `Start` (the caller's
number and name: their conversation, a live call in it, ansa's greeting),
`Turn` (what the caller said, as words: ansa's answer), `End` (hang up).
The first line is the development practice phone (`LinePractice`, below).
A production provider (Vapi, Twilio, Telnyx or LiveKit: chosen at launch)
will be another line: one file that turns its events into these three
calls, and its name in `phone_calls_line_known`. Nothing else changes.

**Rules:**
- A call reaches ansa only when the person couldn't answer, so ansa answers
  whatever "Only when I'm away" says, and never as a draft ("Ask me first"
  can't hold a caller on the line): `assistant.AnswerCall`.
- The brain is told it is a call (`channel: "call"`): short spoken
  sentences, no links or lists, never a silent `no_reply`. ansa's own order
  texts are the spoken ones ("Please say yes to confirm", "tell me the
  address", no promise to message the caller later: `orders.Spoken*`).
- The greeting says who ansa is (the AI label: it never pretends to be the
  person): "Hello! I'm Rafa's AI assistant. Rafa can't take your call right
  now. How can I help?" (`words.go`).
- When ansa may not answer itself (the assistant paused, a person handling
  the conversation, or a request already open in it), it takes messages:
  fixed words, no AI ("Thank you, I'll pass that on..."), counted on the
  call (`phone_calls.messages_taken`). When the call ends, a request is
  opened for them ("A caller left a message", reason `call_message`, routed,
  the owners alerted) unless one is open already. The words stay in the
  encrypted conversation, never on the request.
- After a handover during the call (a complaint, a refund...), ansa says the
  holding reply and takes messages for the rest of the call.
- Only the assistant answering a live call speaks into a phone
  conversation: `chat.RouteWithin` refuses a phone conversation to everyone
  else (a person's reply, an order's status message), and the chat door's
  phone target only marks the words spoken (`chat.go`).
- One live call per conversation: a new call ends one left live (a page
  closed without hanging up). Requests from a call are marked `phone`.

**Table `phone_calls`** (migration 0049): company, conversation (same-company
foreign key), line (a CHECK), started_at, ended_at (empty = live; one live
per conversation, a partial unique index), messages_taken.

**The practice phone (development only, owners):** Settings → Connections →
Practice phone (`/settings/channels/practice-call`). Pretend to be a caller
(any name and number), talk (or type), and hear ansa answer with the
computer's own voice (the browser's speech). A recording (16 kHz mono WAV,
made in the browser: `lib/practice-phone/recording.ts`) is heard by the
brain's whisper.cpp on this computer (`Hear` → `POST /v1/voice/transcribe`,
refused outside development: [brain-assistant](brain-assistant.md)). API:
`GET /api/v1/phone/practice`, `POST .../start`, `.../turn` (text or audio),
`.../end` (`internal/api/phone.go`): refused on a production server and to
members; 30 calls and 300 turns an hour per company.

**Tests:** `phone_test.go` (live database, a fake brain): a call answered as
a chat would be (greeting, the brain told it's a call, no draft in "Ask me
first", nobody else can send into it, an ended call takes no more words);
an order taken in spoken words and placed; a handover then message-taking
(no second request); paused = messages only, and hanging up opens one
request and alerts (never the caller's words on it); a person's greeting;
refusals. `internal/api/phone_test.go`: owners on a development server only.
`brain/tests/test_voice.py`: whisper locked down and development only.
