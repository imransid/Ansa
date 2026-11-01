# assistant (core/internal/assistant)

**What:** core's side of the assistant: the checks every proposed reply
passes before it reaches a customer, ansa's AI label, and (next) the
`assistant.reply` job: when ansa may answer, what it sends the brain, and
sending, drafting or handing over.
**Checks (`checks.go`, the same rules as the old `lib/assistant/reply-checks.ts`):**
- every amount written with a currency mark (symbols, ISO codes, the words
  for the common ones; before or after the number) must be a menu price or
  an amount in the business's own texts; one that can't be read as a price
  of the currency stops the reply (`price_not_on_menu`);
- no refund, compensation or voucher words in English, Italian, Spanish,
  French or German (`refund_promise`);
- every link must appear in the business's own texts (`unknown_link`).
**Prices (`ParsePrice`, `MinorUnitDigits`):** "9.50", "9,50", "€ 12",
"1 200" read in the currency's smallest units (ISO 4217 digits: 0 for yen or
won, 3 for dinars, 2 for most); a minus is no price.
**AI label:** "I'm the AI assistant for <business>." / "I'm <name>'s AI
assistant.", ansa's own first line of the first automated message.
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
prices plus the delivery fee, the owner's own texts). Knowledge articles join
when the knowledge module moves (until then `knowledge` is empty).
**Tests:** `checks_test.go`; `gate_test.go`; `inputs_test.go` (live database:
only available dishes, labelled; the fee; "Tuesday 19:30, open until
midnight"; the decrypted conversation; no id in the request).
