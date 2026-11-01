# home and settings (core/internal/home, core/internal/settings)

**What:** Home's reads (the old `services/away.ts`, `services/home.ts`,
`db/away-summary.ts`) and the owner's switches (`db/assistant-settings.ts`).
**Home (`GET /api/v1/home`, everyone in the company):**
- `presence`: business or person, on or paused, "Always" or "Only when I'm
  away", away now (said "I'm away", or one of the away hours), a few words
  ("You're away: ansa answers", "You're available: ansa answers after 10
  min"), and whether this person may change it (owners).
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
**Switches (owners; 60 settings changes per 10 minutes per person):**
`POST /api/v1/assistant/status {"status": "on"|"paused"}`,
`.../away {"away": bool}`, `.../answer-when {"answerWhen": "always"|"when_away"}`.
Each takes the company row lock first, then reads the person again (still
an owner), in one transaction (`settings.asOwner`). "Got it":
`POST /api/v1/home/away-summary/seen` (anyone in the company).
**Tests:** `api/home_test.go` (live database): the page and the checklist;
pause, "only when I'm away" and "I'm away" change what the card says and
show the summary; "Got it"; a member can't pause and gets no checklist.
**Still on the old backend:** "Your business in numbers" (tickets, calls,
emails, posts: with those modules).
