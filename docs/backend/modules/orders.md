# orders (core/internal/orders)

**What:** orders a customer places in a chat, collected by the assistant and
written up by ansa (the old `lib/orders.ts`, `lib/order-steps.ts`,
`db/order-proposals.ts`). The AI only names dishes by today's menu labels
(M1...) and how many, delivery or pickup, the address, when and notes. A
dish it names by its exact name instead is found too, when exactly one of
today's dishes has that name (`dishes.go`, step 58: the AI sometimes writes
the name; the price is still the menu's and the customer confirms).
**Every price, line and total is ansa's own (`orders.go`, pure):** the same
dish twice is one line; 1-50 of one dish; at most 30 lines; the delivery fee
only for delivery; "As soon as possible" when no time was said; a line,
subtotal or total past 2,147,483,647 smallest units goes to a person, as a
dish ansa can't place (the amount columns are 32-bit: such an INSERT failed
and left the customer without an answer).
**The plan (`plan.go`, `PlanStep`, pure):** a person's account, a business
that takes no orders here, or one offering neither delivery nor pickup = a
person (`order`; setup refuses that last one now, "Choose delivery, pickup
or both to take orders."); a "yes" = place; a "no" =
take it back; closed now by its own hours = ansa's "we can't take orders
right now (opens at 18:00)"; a dish neither a label nor the one exact name
of today's menu, or a count outside 1-50 = a person (`order_unclear`); a missing way or address = ansa's fixed
question (never one promising a way the business doesn't offer); else
ansa's summary (every line, the fee, the total, how, when, notes, "Reply
yes to confirm"). The AI's reply text is never sent on an order.
**Texts (`texts.go`, `texts_bangla.go`, pure):** every fixed text (the
questions, the summary, the confirmation, the "no", closed now, the status
messages, and their spoken forms for a call) is in the customer's language:
Bangla when their newest message is mostly Bengali script (`LanguageOf`,
U+0980-U+09FF; the assistant reads it from the conversation, a status
button from the customer's newest message), else English, word for word as
before. Numbers and prices are written the same way in both; the Bangla
summary starts "আপনার অর্ডার:", which the brain is told as it is told
"Here is your order". On a call (`texts_spoken.go`) amounts are said as a
person says them: "700 taka", "19.50 euros" (decimals only when there are
some, `money.SpokenNumber`), never "BDT 700.00"; in Bangla with Bengali
digits and the currency's Bangla word ("২ Kacchi, ৯০০ টাকা"); a currency
without words keeps its code.
**Rows (`store.go`):** the summary is saved with its order ("proposed", one
per conversation, unnumbered, address and notes encrypted with
`order-<field>:<company>:<order>`), replacing the one being written up. A
"yes" places it ONLY once its summary reached the customer (sending, sent or
unclear: not a draft or discarded), under the company row lock (taken by
the caller first), with the company's next number, status "new". A "no"
deletes the proposal. The brain reads this conversation's order being
written up and its newest 3 placed ones, each line with its menu label.
**In the assistant (`assistant/order.go`):** a question or summary goes out
like a reply (waiting in Ask me first); the confirmation and "No problem:
nothing was ordered." are sent at once (never wait; the AI label first when
nothing automated reached the customer yet, and a reply still waiting is
discarded, as a newer reply discards it), each in ONE
transaction that checks the conversation again; placing also queues the
`order.alert` job (see [alerts](alerts.md): number, who, where and ansa's
total, a link to /orders; never the dishes or the address) and writes the
"order_placed" line. A "yes" with nothing to say yes to goes to a person.
**Money (`core/internal/money`):** `Format` ("€9.50", "¥1,200",
"BDT 1,200.00"), `ParsePrice` and `MinorUnitDigits` (ISO 4217): amounts are
whole smallest units, never floating point. `ParsePrice` reads any script's
digits (`WithASCIIDigits`: "৪৫০"); one "." or "," before at most the
currency's decimals is the point ("12,50"), one before exactly three digits
groups thousands ("1,200", "9.999" too), unless the currency has three
decimals (KWD's "1.250"); with both marks the last is the point ("1.200,50",
"1,200.50"); a mark used twice groups, in threes or the South Asian way
("1,50,000"). The screens' copy (`lib/menu.ts` `parsePrice`) reads the same
cases, `money/testdata/prices.json`.
**Tests:** `orders_test.go` (pricing, gaps, the 32-bit limit, neither
delivery nor pickup, the summary word for word, the plan, status texts);
`texts_bangla_test.go` (the language of a newest message, every Bangla
text, the plan in the customer's language); `texts_spoken_test.go` (amounts
on a call); `assistant/order_test.go` (live database, a fake brain:
summary priced by ansa with the address encrypted, a "yes" places #1 with
ansa's total, sends the confirmation and queues the alert, the brain sees
the order in progress, a second "yes" goes to a person; a "no" takes it
back; a Bangla customer's texts); `money_test.go` (the shared cases);
`alerts_test.go` (the new-order email); `api_test.go` (the page's list,
whether the package has orders, a status change through core's API, and
one the customer isn't told about).
**The Orders page (`page.go`, `status.go`):** "To do" (new, accepted,
ready; oldest first, 100) and "Finished" (newest 30), each order with its
lines, fee, total, how, when, the address and notes decrypted ("(could not
be decrypted)" otherwise). One button for the next step (`Change`): anyone
in the company (read again FOR SHARE); the status checked in the UPDATE (a
second press finds it changed); the customer's short fixed message
(`StatusText`) saved in the same transaction as a person's message that
doesn't take the conversation over, only when the chat may take one now;
otherwise the status still changes and core answers why (the chat's
refusal code, or "send-failed") with the order's number and the customer's
channel: the page words it for that channel (`lib/order-notices.ts`) and
keeps it in its address, as the pressed button is gone once the order moved
on. The list says whether the package includes orders
([packages](packages.md)): without, the page says orders go to the owners
as requests. Served by core's API ([api](api.md)), which the Orders page
calls. `CountNew` is Home's "N new orders".
