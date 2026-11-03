# assistant (core/internal/assistant)

**What:** core's side of the assistant: the `assistant.reply` job (when
ansa may answer, what it sends the brain, the checks every proposed reply
passes, and sending, drafting or handing over to a person), as the old
`services/assistant-reply.ts` and `assistant-handover.ts`.

**One run (`reply.go`, `Runner.Answer`), in this order:**
1. The gate (below), read before anything else: not "may" = quiet.
2. When ansa answers (`availability.go`, the old `decideCover`): "always",
   or "when_away" while you said you're away or it is one of your away hours;
   otherwise it waits `reply_grace_minutes` (`assistant_due_at` set, the
   catch-up looks again; outcome "waiting") or leaves it to you. The
   catch-up's own run (`coverAfterNoReply`) skips this step.
3. The customer's hourly limit (20 per conversation: past it, quiet and the
   message counts as handled), then the slice (`GatherInputs`).
4. An important person goes to a person at once (`important_person`), no AI.
5. The business's hourly limit (200: past it, `reply_limit`).
6. The brain (`POST /v1/assistant/reply`, signed). Its answer is checked
   again by core: a reply must pass the checks below; an unknown kind is
   `unusable_answer`; the brain down is `model_failed`; an own key that
   can't be read is `model_unavailable` (ansa's key never replaces it).
   Order answers go to ansa's own order steps ([orders](orders.md)).
7. A reply that passes is saved in ONE transaction that checks the gate
   again with the conversation locked: "sending" (Automatic) or a "draft"
   (Ask me first; a waiting draft is discarded), the AI label on the first
   automated message to reach the customer (sending, sent or unclear: a
   reply waiting, discarded or failed never did, so a draft that replaces a
   waiting one keeps the label), the "replied" / "drafted" line, the
   message marked handled. Then it is sent (`chat.Sender`) and its result
   recorded. A reply the channel refuses or fails asks a person
   (`send_failed`, no holding reply: the channel can't take one).
The same message is never answered twice: a retried job finds it handled.
Channels queue the job 1.5 s after the message, so a burst gets one answer.

**Handover (`handover.go`):** ONE transaction, the company row lock first
(as every routing), the gate again: a reply of ansa's still waiting (Ask me
first) discarded (it answered an earlier message; the request covers the
conversation now, and nothing may go after the holding reply), the
business's holding reply (never the AI's text; with the AI label when
first) saved "sending" when the channel can take it, a request
(`tickets.CreateChatTicketWithin`: the AI's subject
cleaned to one plain line, else "<Channel> conversation needs you"; the
reason's words, then the AI's summary; its category only when it names an
active one exactly; routed, and whoever routing picks is emailed by the
`ticket.assigned` job), the "handed_over" line with the reason, the message
handled, and the `owner.alert` job (starts 20 s later, so it can say whether
the holding reply arrived; see [alerts](alerts.md)). Then the holding reply
is sent. While the request is open the assistant stays quiet. Reasons and
their words: `reasons.go`.
**Checks (`checks.go`, the same rules as the old `lib/assistant/reply-checks.ts`):**
- every amount written with a currency mark (symbols, ISO codes, the words
  for the common ones, and taka as Bangladesh writes it: "Tk 450", "Tk.
  450", "450 Tk", "৪৫০ টাকা"; before or after the number) must be a menu
  price or an amount in the business's own texts; one that can't be read
  as a price of the currency stops the reply (`price_not_on_menu`). Every
  script's digits are read as 0-9 first, in the reply and in the
  business's texts (`WithASCIIDigits`: "৳৩০০" is "৳300"; RE2's `\d` is 0-9
  only, so a price in Bengali digits passed unread). Thousands in groups
  of three are one amount, whatever the separator ("15,000", "1 200",
  "1.040,50": step 58; "15,000" was read as no price and stopped every
  reply naming one);
- no refund, compensation or voucher words in English, Italian, Spanish,
  French, German or Bangla (রিফান্ড, টাকা ফেরত, ক্ষতিপূরণ, ভাউচার; never a
  bare ফেরত, "back": ফেরত কল is a call back) (`refund_promise`);
- every link must appear in the business's own texts (`unknown_link`).
**Prices (`ParsePrice`, `MinorUnitDigits`):** "9.50", "9,50", "€ 12",
"1 200" read in the currency's smallest units (ISO 4217 digits: 0 for yen or
won, 3 for dinars, 2 for most); a minus is no price.
**AI label:** "I'm the AI assistant for <business>." / "I'm <name>'s AI
assistant.", ansa's own first line of the first automated message the
customer gets (a reply, a holding reply or one of ansa's order texts).
**Gate (`gate.go`, the old `gateWithin`'s order):** not found → paused →
taken over by a person → the message handled already → a request open in the
conversation → a newer customer message (it gets its own run) → may. Read
again, with the conversation row locked, inside the transaction that saves.
`MarkHandledWithin` records the message as answered (never answered twice).
**Inputs (`inputs.go`, the old `services/assistant-inputs.ts`):** one
company's slice for the brain (`request.go`'s `BrainRequest`): its name,
what it offers, address, phone; hours with "now" in its own zone (a person:
their away hours and whether they said they're away); delivery, pickup,
payment, whether it takes orders and the delivery fee; the dishes available
now, labelled M1..., with prices as the menu shows them (`money.go`); the
owner's instructions; active category names; the newest 20 messages of this
one conversation, decrypted (drafts, discarded and failed ones never reached
the customer). Never an id. Also what core checks the reply against (menu
prices plus the delivery fee, the owner's own texts). The best 3 approved
support articles matching the customer's newest 3 messages, their words
in turns, newest first (`knowledge.CombineSearchTexts`: a follow-up like
"And for 50?" keeps the article of the question before it), within 3,000
characters, in escaped `<article>` tags (`AddKnowledge`,
`inputs_knowledge.go`, see [knowledge](knowledge.md)); their titles and
texts count as the owner's own words. The
engine goes too: "api_key" with the business's own key decrypted
(`KeyContext`: `assistant-anthropic-key:<company>`) or nil for ansa's own
(the brain holds it), or "claude_code" (development only, refused by the
brain in production).
**Tests:** `checks_test.go` (also Bengali digits, Tk and টাকা, and the
Bangla refund words); `gate_test.go`; `inputs_test.go` (live database:
only available dishes, labelled; the fee; "Tuesday 19:30, open until
midnight"; the decrypted conversation; no id in the request);
`inputs_knowledge_test.go` (live database, a fake brain: a price written
only in an article's title may be quoted; a follow-up finds the article of
the question before it; the customer's newest messages, newest first);
`reply_test.go` (live database, a fake brain, never the real model): a reply
goes out once with the AI label; a made-up price is never sent and a person
is asked (holding reply, request, line, alert queued) and the assistant then
stays quiet; the AI's own request keeps its cleaned subject and category;
paused is quiet without asking the brain; Ask me first saves a draft; an
important person is handed over without the brain; "when away" waits, then
the catch-up's run answers; the brain down = the holding reply; an own key
that can't be read is never replaced by ansa's. `drafts_test.go` (Ask me
first and the AI label): a draft that replaces a waiting one keeps the
label, and the next one after a reply reached the customer has none; a
handover while a draft waits discards it and labels the holding reply; an
order text sent while the summary waits discards it and has the label.

**Calls (`call.go`, `call_handover.go`, `call_summary.go`, step 55,
[phone](phone.md)):** `AnswerCall` answers a live call's turn (the caller's
words are the newest message of their phone conversation) with the same
brain, checks, orders and handovers, for the WHOLE call: the gate's
`OnACall` lets it answer while paused, taken over or with a request open
(the caller is on the line), whatever the away settings say, never as a
draft. The brain is told `channel: "call"` (spoken words) and, while ansa
may only take a message (paused, a person handling the conversation, a
caller marked important: `CallTakesMessagesOnly`), `call_mode:
"message_only"`: then no order step runs. ansa's own order texts are the
spoken ones, and the words are saved for the call to speak (`routeWithin`:
the phone target). A handover on a call (`callHandOver`, which `handOver`
sends every call's to) says the AI's own words when they pass `CheckReply`
(`Handover.CallerHears`), else the holding reply, or "I'll pass that on"
once a request is open, and opens a request only when none is open.
`SpokenAfter` reads what ansa said after the caller's words; after a
`no_reply` it keeps the line open ("Is there anything else..."). Past
`assistant-call` (60 turns an hour per caller) or the business's hourly
answers, fixed words take the message. When the call ends,
`CallMessagesLeftWithin` opens the request for messages taken (reason
`call_message`, unless one is open), and the `phone.call_summary` job
(`HandleCallSummaryJob`) asks the brain for the call's note: added to the
open request (its subject too when ansa opened it during this call:
`tickets.RetitleAfterCallWithin`), or a request opened for it when someone
has to act.

**Packages (`package_limits.go`, step 57, [packages](packages.md)):** before
the AI writes a chat reply, the company's package decides: Messenger where
the package doesn't include it (Personal) hands over (`not_in_package`);
otherwise one AI reply is counted, unless the business's own Claude key
writes it, and with none left (or the free trial over) it hands over
(`package_used_up`): the holding reply and a request, the AI not asked.
Orders are offered to the brain only where the package includes them. On
a call, the package's call minutes (the month's finished calls plus the
live one so far) join the call's limits: past them, fixed words take the
message.

**Catch-up (`catchup.go`, the old `services/assistant-due.ts`):** every 15 s
(core's scheduler, see [schedule](schedule.md)) core claims the
conversations whose "if I haven't answered within N minutes" is due, of every
company (one cross-company claim, listed in `CROSS_COMPANY.md`: its due time
cleared in ONE UPDATE, SKIP LOCKED), and in the same transaction queues the
reply job for the customer's newest message with `coverAfterNoReply`,
unless a person or the business's own app answered after it. Up to 50 a
round. Unlike the old backend, this needs no outside scheduler: core runs
all the time. Test: `catchup_test.go` (only the conversation nobody answered
is queued, once).
