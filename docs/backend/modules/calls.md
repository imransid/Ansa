# calls (core/internal/calls, brain/brain/calls)

**What:** Phone calls (the old `services/vapi-webhook.ts`,
`services/vapi-tool-calls.ts`, `services/call-analysis.ts`,
`services/calls.ts`, `services/call-escalation.ts`,
`services/call-recordings.ts` and `lib/call-brain/`). Vapi runs the live
conversation; core keeps each finished call, answers the live assistant's
knowledge searches, and has the brain decide whether the call was solved
or a person must follow up. Not tested against a real Vapi account (no
account yet): the field paths and the signing follow Vapi's docs.

**The webhook (`webhook.go`, `signature.go`, `POST /webhooks/vapi`):** the
order every webhook keeps: at most 1 MB, raw bytes, Vapi's signature
(HMAC over "{timestamp}.{body}" or "{body}", every part a VAPI_* setting,
compared in constant time; a signed timestamp must be within the
tolerance; no secret = every request refused), 10,000 a minute per IP (a
ceiling: all of Vapi's traffic shares it), then JSON. Only two message
types matter:
- `end-of-call-report`: the company comes ONLY from `phone_lines` (Vapi's
  number id, which only ansa's operator links); an unknown line is ignored
  with a fixed log line. The call is saved once per Vapi call id, the
  transcript encrypted (`call-transcript:<company>:<vapi call id>`), the
  caller joined to their conversation (by the number's digits; a hidden
  caller has none), and its analysis queued as the job `call.analyze`, in
  ONE transaction. The recording is copied after the answer
  (`recording.go`, through `internal/download`: https on VAPI_RECORDING_HOSTS
  only, checked again on every redirect, audio only, 100 MB, one minute;
  stored at `recordings/<company>/<call>.<ext>`). Its address is never
  stored or logged, so a failed copy is not tried again.
- `tool-calls` (`tools.go`): always HTTP 200 with one entry per tool call
  that has an id. The one tool, `search_company_knowledge`, takes
  `{ "query" }` (an object or a JSON string), one plain line of 1-500. The
  company comes from the phone line; an unknown line or a web call answers
  "This phone number is not set up." and searches nothing. 120 searches a
  minute per company. Up to 3 approved support pieces, each in escaped
  `<article>` tags on one line within 1,500 characters
  (`knowledge.BuildCallAnswer`); nothing found = a fixed line telling the
  assistant to offer a ticket. Each search is recorded in
  `knowledge_lookups` (article ids and hit count, never the question)
  BEFORE its answer is given. The live transcript (`message.artifact`) and
  `message.phoneNumber` are never read.

**The decision (`analysis.go`, job `call.analyze`, and "Analyze now"):** the
call is CLAIMED in one UPDATE (pending, or analyzing for 5+ minutes), so it
is never sent twice at once. The brain gets the decrypted transcript and
the active category names only (no company, caller number or ids) and
answers with the old rules (`brain/brain/calls/`): the transcript slice
(first 4 and last 16 turns, 8,000 characters, card-like numbers and
addresses hidden), rules before the model (no transcript, the customer
never spoke, an abnormal end), then the model (effort high, 8,000 tokens, 60 s
a try, 2 retries), then the strict "solved" check: ONE whole sentence of
the customer's last two turns. Anything missing, odd, refused or failed is
"needs_human"; a brain that doesn't answer is `model_error` with the class
`BrainUnavailable`; a "solved" without its sentence is `invalid_output`.
The decision and a "needs_human"'s request (channel "phone", the AI's
subject or "Phone call needs follow-up", its summary and why, the category
by id, routed as every new request, its assignee emailed) are saved in ONE
transaction, with ansa's line in the conversation (`call_solved` /
`call_needs_person`). The AI's texts are stored encrypted
(`call-ai-issue`, `call-ai-explanation`, `call-ai-evidence:<company>:<call>`);
the transcript never goes on a request. If saving fails, an
`analysis_error` escalation is saved instead.

**Escalate to a ticket (`escalate.go`):** anyone in the company, on a call
decided "solved" without a request: ONE transaction claims the call
(records who and when; the AI's verdict never changes, so wrong "solved"
verdicts can be counted), then makes its request ("escalated" history row,
the AI's summary and the teammate's note, never the transcript), routed.

**The pages (`page.go`):** the list (filters all / solved / needs_human /
stuck, a search of the caller's number by text or digits, 50 a page, the
count of every filter), a call (the transcript and the AI's notes
decrypted, "could not be decrypted" said, never shown as empty; who
escalated it; its request's number; whether "Analyze now" and "Escalate"
make sense), the knowledge it looked up (by Vapi's call id within the
company; a deleted article has no title), and its recording.

**API ([api](api.md)):** `GET /api/v1/calls?outcome=&q=&page=`;
`GET /api/v1/calls/{id}` → `{call, lookups, moreLookupsNotShown,
categories}`; `POST /api/v1/calls/{id}/analyze` (20 per 10 minutes per
person: each is a paid AI request); `POST /api/v1/calls/{id}/escalate`
`{categoryId, note}` (the ticket-creations limit, shared with New request;
409 when it can't be escalated); `GET /api/v1/calls/{id}/recording` →
`{"url"}` (a 5-minute signed link) or, in development, `{contentType,
data}` (200 plays per 10 minutes per person; 429, never 404).

**Settings ([config](config.md)):** VAPI_WEBHOOK_SECRET, VAPI_SIGNATURE_HEADER,
VAPI_TIMESTAMP_HEADER, VAPI_SIGNATURE_ALGORITHM, VAPI_SIGNATURE_PAYLOAD,
VAPI_SIGNATURE_ENCODING, VAPI_SIGNATURE_PREFIX, VAPI_TIMESTAMP_UNIT,
VAPI_TIMESTAMP_TOLERANCE_SECONDS, VAPI_RECORDING_HOSTS (the old defaults).

**Logging rule:** never a transcript, a question, an answer, a recording's
address or a file key; fixed lines and class names only.

**Tests:** `webhook_test.go` (unsigned = 401 and nothing saved; a signed
report saved once, encrypted, in the caller's conversation, its analysis
queued; an unknown line ignored; the live search answers from the
company's approved articles, records the lookup, refuses an unknown tool
and an empty question, and searches nothing for an unknown line),
`analysis_test.go` (a "needs_human" makes its request in the conversation
with the category by id; a decided call isn't analyzed again; a "solved"
keeps the customer's sentence and is escalated once, its verdict kept; a
silent brain and an unproven "solved" escalate), `api/calls_test.go` (the
list and its counts, stuck, a search by digits; another company's call is
404 and can't be escalated), `knowledge/callanswer_test.go` (one escaped
line; a long piece cut after a sentence). The brain's rules:
`brain/tests/test_calls.py`.
