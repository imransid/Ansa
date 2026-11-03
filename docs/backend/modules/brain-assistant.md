# brain: the assistant (brain/brain/assistant/, brain/brain/ai.py)

**What:** the thinking behind one reply to a customer. Core sends
`POST /v1/assistant/reply` (signed) with ONE company's slice (`models.py`,
strict: an unknown field is refused); the brain answers a decision.
**Prompt (`prompt.py`):** the same words as the old `lib/assistant/prompt.ts`
and `order-prompt.ts`: a business's or a person's system prompt, and the data
in tags (business, hours, ordering, menu with labels, the order in progress
and placed orders, the owner's instructions, articles, categories, the newest
20 messages of this one conversation). Every value escaped (`text.py`); the
customer's words with card-like and social-security-like numbers and email
addresses hidden, the owner's with secret numbers hidden. Each message's
line is named by its side: "Customer" and "Restaurant", or for a person
"Sender" and "<their name>'s side" (theirs, and ansa's for them; never
"Restaurant"). No prompt names one chat: customers write on WhatsApp,
Messenger and Telegram alike ("in its chats").
**Model (`ai.py`):** Anthropic's SDK, one structured JSON answer
(`output_config.format: json_schema`), effort low, 3,000 tokens, 30 s, one
retry; the business's own key when core sends one, else ansa's; on an error
only the class name is kept (never its text). Between two tries it waits at
most 8 s (`MAX_RETRY_WAIT_SECONDS`; the SDK alone would wait as long as a
429's retry-after asks, long after core gave up). The SDK never logs or traces,
whatever ANTHROPIC_LOG or its tracing settings say (its loggers kept above
every level, `open_telemetry` with no spans and no trace headers; test:
`test_the_ai_door_never_logs_or_traces`).
**Claude Code (`claude_code.py`, DEVELOPMENT ONLY):** when core sends
`engine: "claude_code"` and the brain runs with `ANSA_ENV=development`, the
answer comes from `claude -p` on this computer's Claude Code login (Anthropic
doesn't allow a product to run on a claude.ai login: in production the brain
answers `model_unavailable`). Locked down as the old adapter: no tools, no
MCP, no settings, CLAUDE.md or memory, no saved session, an empty temporary
folder, only PATH, HOME, USER, LOGNAME, LANG and TMPDIR passed on (never a
secret), the conversation on stdin, 90 s. `CLAUDE_CODE_PATH` names the program
(else `claude` on the PATH); `/v1/status` says Claude Code can answer only
while that program is there and may be run (looked for, never run).
**Threads:** the reply endpoint is a plain `def`, so FastAPI runs it in a
worker thread: a model call that takes seconds never holds up other requests.
**Answer (`answer.py`):** read strictly: exactly the schema's fields;
`reply` (1–1,500 characters, cleaned), `needs_person` (a reason from the
allowed list, a one-line subject, a summary, a category), `no_reply`,
`order_summary` (items by label with whole quantities), `order_confirmed`,
`order_withdrawn`. Anything else, or no model, or a failure, is
`{"kind":"failed","reason": model_unavailable | model_failed | unusable_answer}`:
core then sends the holding reply, never the model's text.
**Calls (step 55):** `channel: "call"` adds the call rules (a warm, smart
assistant on the phone: the caller's own language, Bangla included, one
follow-up question when it needs more, never `no_reply`, a handover with
words for the caller in `reply`, never their number asked: the call has it)
and the `CALL_REPLY` settings (effort medium, 3,000 tokens, 40 s, one
retry); `call_mode: "message_only"` adds that it may only take a message.
On a `needs_person` the answer also carries `text` (the words for the
caller; core checks them and uses them on a call only).
`POST /v1/calls/summary` (`call_summary.py`, `CALL_SUMMARY`: effort medium,
2,000 tokens, 45 s, one retry): the note about a finished call for the
person (who called, what they want, how and when to reach them, in the
call's language, at most four sentences) and whether someone has to act;
the call's lines escaped and hidden like a reply's, the company's own
engine; a failure is `{"kind":"failed","reason":...}`.
**Core's checks (prices, links, refunds) run in core, not here.**
**Tests:** `tests/test_call_summary.py` (the note's prompt, escaping and
strict reading); `tests/test_assistant.py` (a fake model): the prompt's contents,
escaping and hiding; a person's prompt; each side of the conversation named
for whom ansa answers, and no chat named; strict reading; failures; the
endpoint needs core's signature; Claude Code is refused outside development,
gets the conversation on stdin only and none of the brain's secrets (a fake
program: nothing is ever run).
