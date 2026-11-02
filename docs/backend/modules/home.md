# home and settings (core/internal/home, core/internal/settings, core/internal/hours)

**What:** Home's reads (the old `services/away.ts`, `services/home.ts`,
`db/away-summary.ts`) and the owner's switches (`db/assistant-settings.ts`).
**Home (`GET /api/v1/home`, everyone in the company):**
- `presence`: business or person, on or paused, "Always" or "Only when I'm
  away", away now (said "I'm away", or one of the away hours), a few words
  ("You're away: ansa answers", "You're available: ansa answers after 10
  min"), "I'm away" since when, the minutes ansa waits for you, and
  whether this person may change it (owners).
- `gettingStarted` (owners only; empty once all are done): Telegram
  connected and allowed to reply, an AI ready (the business's own key,
  ansa's key, or Claude Code in development: the brain's signed `/v1/status`
  says which it has, never a key), and a business's menu or a person's
  instructions.
- `awaySummary` (only in "Only when I'm away"): ansa's replied / drafted /
  handed-over lines since this person last pressed "Got it" (or the last
  day): counts of the newest 200 and the newest 8 conversations, each once.
- `needsYou` (the newest 5 conversations that need a person, how many, and
  whether more than one person takes requests), `newOrders`, `activity`
  ("What ansa did", newest 6).
- `overview` ("Your business in numbers", `overview.go`): open and
  unassigned requests, calls of the last 7 days and those the AI solved,
  emails being read and stuck, conversations that need a person; once the
  company started the marketing helper (a fact, an interview answer or a
  draft) also drafts waiting, posts scheduled within 7 days, needing
  attention and failed in the last 7 days, key facts confirmed (of 16) and
  social accounts to reconnect as of now. Each count reads at most 10,001
  rows ("10,000+") with the condition of the list it links to.
- `undeliveredEmails` (customer emails never delivered, as the Emails
  page lists them) and `handlesNoCategory` (the company has categories,
  this person handles none).

**The sidebar's foot (`GET /api/v1/glance`, every page):** the company's
name, the person's name, address and role, what ansa does now ("Paused",
"Away: ansa answers for you", "Answers on its own"...) and today's hours
in the business's own time zone ("Open until 23:00").
**Switches (owners; 60 settings changes per 10 minutes per person):**
`POST /api/v1/assistant/status {"status": "on"|"paused"}`,
`.../away {"away": bool}`, `.../answer-when {"answerWhen": "always"|"when_away"}`.
Each takes the company row lock first, then reads the person again (still
an owner), in one transaction (`settings.asOwner`). "Got it":
`POST /api/v1/home/away-summary/seen` (anyone in the company).
**Settings → Assistant (`GET /api/v1/settings/assistant`, everyone reads):**
the saved settings (defaults until anything is saved) and the engine's
state: whose key answers ("restaurant": the business's own, shown only by
its last four; "ansa"; or "none"), whether Claude Code is allowed (the
brain says so: development only) and whether an AI is ready. Owners save
(60 changes per 10 minutes):
- `POST /api/v1/settings/assistant` `{status, replyMode, instructions
  (0-2,000), holdingReply (1-500), alertByEmail}`: texts cleaned as typed
  (`plaintext.Note`: a line break counted once, no control characters);
  field problems answer 400 `{"fields": {...}}` in the old form's words.
- `.../engine` `{engine, apiKey, removeKey}`: a key of Claude's shape
  (`sk-ant-...`) is stored encrypted for the company
  (`assistant-anthropic-key:<company>`); Claude Code is refused unless the
  brain allows it (development).
- `.../away` `{timeZone, awayHours: {mon: [{opens, closes}], ...},
  replyGraceMinutes: 5|10|15|30|60|null}`: each day read as the old form did
  (`hours.ReadDay`, word for word: both times, "18:30" form, a closing of
  00:00 is midnight, no overlap, at most two a day), a time zone this server
  knows.
**Try your assistant (`POST /api/v1/assistant/try {"text"}`, owners, 20 per
10 minutes):** the same slice, engine and checks as a real reply, on one
typed message as a customer's first; answers `{outcome: reply | handover |
no_reply, text (with the AI label), why}`. Nothing is saved, sent or alerted.
**Tests:** `api/home_test.go` (live database): the page and the checklist;
pause, "only when I'm away" and "I'm away" change what the card says and
show the summary; "Got it"; a member can't pause and gets no checklist.
`api/assistant_settings_test.go`: defaults; an empty holding reply refused
with its words; saved; an own key stored encrypted and shown by its last
four; Claude Code refused without the brain's say-so; away hours' problems
by field, then saved; a try answers with the AI label and saves nothing.
`hours/typed_test.go`: the old form's day rules, word for word.
**"Your business in numbers"** (tickets, calls, emails, posts):
`overview.go` (`ReadOverview`): each count the company's own, read with the
condition of the list it links to, at most 10,001 rows ("10,000+").
