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
- The AI answers every turn, for the whole call (the brain is told
  `channel: "call"`): short spoken sentences in the caller's own language
  (Bangla included), one follow-up question when it needs to know more (who
  is calling, what about, how and when to reach them; never their number:
  the call has it), never a silent `no_reply`, never a promise of a time,
  money or a decision. It thinks more than in a chat (`CALL_REPLY`: effort
  medium). ansa's own order texts are the spoken ones ("Please say yes to
  confirm", no promise to message the caller later: `orders.Spoken*`).
- The greeting says who ansa is (the AI label: it never pretends to be the
  person): "Hello! I'm Rafa's AI assistant. Rafa can't take your call right
  now. How can I help?" (`words.go`).
- When ansa may not answer on anyone's behalf (the assistant paused, a
  person handling the conversation, a caller marked important:
  `assistant.CallTakesMessagesOnly`), the AI only takes a message
  (`call_mode: "message_only"`): no answers for them, no order. The greeting
  says so, and each such turn counts as a message taken
  (`phone_calls.messages_taken`).
- A handover doesn't end the call: the caller hears the AI's own words when
  they pass core's checks (prices, refunds, links), else the holding reply
  (or, with a request open, "Thank you, I'll pass that on"), and the AI goes
  on with the next turn. A request is opened (routed, ansa's line, the
  owners' alert) only when none is open in the conversation: one per call at
  most. A request already open doesn't stop the AI either.
- The package's call minutes (step 57, [packages](packages.md)): each call's
  length is counted when it ends; with no minutes left this month the
  greeting takes a message and fixed words take it, no AI.
- Past a caller's 60 turns an hour (`assistant-call`) or the business's 200
  AI answers an hour, ansa takes messages with fixed words (no AI).
- When the call ends: a request "A caller left a message" (reason
  `call_message`) for the messages taken, unless one is open; and a job
  (`phone.call_summary`, `assistant.HandleCallSummaryJob`) asks the AI for
  the call's note (`POST /v1/calls/summary`, the company's own AI engine:
  who called, what they want, how and when to reach them, in the call's
  language; the call's first 8 and newest 32 lines). The note is added below
  the open request's description ("After the call: ...", while it has room:
  10,000 characters), gives a request ansa opened during this call the
  note's subject (unless its subject was changed before; the history says
  "ansa updated the subject after the call"), or opens a request when
  someone has to act and none is open. A note that fails changes nothing.
  The caller's own words stay in the encrypted conversation; a request
  carries the AI's short summaries only, as a chat's does.
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
(any name and number), pick the language you'll speak (English or Bangla)
and how ansa hears you, talk (or type), and hear ansa answer:
- Hearing: "This browser's speech service" (the default where the browser
  has one; Chrome's is Google's, so the voice goes to Google; it hears
  Bangla well) sends the words it heard; "Whisper on this computer" keeps
  the voice on the laptop: a 16 kHz mono WAV made in the browser
  (`lib/practice-phone/recording.ts`), heard by the brain's whisper.cpp
  (`Hear` → `POST /v1/voice/transcribe` with the language, refused outside
  development: [brain-assistant](brain-assistant.md)); it hears Bangla
  poorly and takes about 8-10 seconds a turn.
- Speaking: the browser's voice of the words' own language
  (`lib/practice-phone/speech.ts`). Chrome on a Mac has no Bangla voice: a
  Bangla answer is only shown, and the page says that Microsoft Edge (free)
  has Bangla voices.

API: `GET /api/v1/phone/practice`, `POST .../start`, `.../turn` (text, or
audio with its language `en` or `bn`), `.../end` (`internal/api/phone.go`):
refused on a production server and to members; 30 calls and 300 turns an
hour per company.

**Tests:** `phone_test.go` (live database, a fake brain): a call answered as
a chat would be (greeting, the brain told it's a call, no draft in "Ask me
first", nobody else can send into it, an ended call takes no more words);
an order taken in spoken words and placed; after a handover the AI's checked
words are said and the AI goes on, one request for the whole call, a refund
promise never said; no words of the AI's = the holding reply; paused = the
AI only takes a message (no order) and hanging up opens one request (never
the caller's words on it); past the call limit = fixed words; a person's
greeting; refusals. `note_test.go`: the note opens a request when someone
has to act, joins the open one, gives a request opened during the call its
subject (never one from before), a call fully helped needs nobody, a failed
note changes nothing; an important caller gets message-only and the request
says why. `internal/api/phone_test.go`: owners on a development server only,
a language the brain doesn't hear refused. Brain: `tests/test_voice.py`
(whisper locked down, development only, the language passed on),
`tests/test_call_summary.py` (the note's prompt, escaping and strict reading).
