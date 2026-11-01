# orders (core/internal/orders)

**What:** orders a customer places in a chat, collected by the assistant and
written up by ansa (the old `lib/orders.ts`, `lib/order-steps.ts`,
`db/order-proposals.ts`). The AI only names dishes by today's menu labels
(M1...) and how many, delivery or pickup, the address, when and notes.
**Every price, line and total is ansa's own (`orders.go`, pure):** the same
dish twice is one line; 1-50 of one dish; at most 30 lines; the delivery fee
only for delivery; "As soon as possible" when no time was said.
**The plan (`plan.go`, `PlanStep`, pure):** a person's account, or a business
that takes no orders here = a person (`order`); a "yes" = place; a "no" =
take it back; closed now by its own hours = ansa's "we can't take orders
right now (opens at 18:00)"; a label not on today's menu or a count outside
1-50 = a person (`order_unclear`); a missing way or address = ansa's fixed
question; else ansa's summary (every line, the fee, the total, how, when,
notes, "Reply yes to confirm"). The AI's reply text is never sent on an order.
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
nothing was ordered." are sent at once (never wait), each in ONE
transaction that checks the conversation again; placing also queues the
`order.alert` job (see [alerts](alerts.md): number, who, where and ansa's
total, a link to /orders; never the dishes or the address) and writes the
"order_placed" line. A "yes" with nothing to say yes to goes to a person.
**Money (`core/internal/money`):** `Format` ("€9.50", "¥1,200",
"BDT 1,200.00"), `ParsePrice` and `MinorUnitDigits` (ISO 4217): amounts are
whole smallest units, never floating point.
**Tests:** `orders_test.go` (pricing, gaps, the summary word for word, the
plan, status texts); `assistant/order_test.go` (live database, a fake brain:
summary priced by ansa with the address encrypted, a "yes" places #1 with
ansa's total, sends the confirmation and queues the alert, the brain sees
the order in progress, a second "yes" goes to a person; a "no" takes it
back); `money_test.go`; `alerts_test.go` (the new-order email); `api_test.go`
(the page's list and a status change through core's API).
**The Orders page (`page.go`, `status.go`):** "To do" (new, accepted,
ready; oldest first, 100) and "Finished" (newest 30), each order with its
lines, fee, total, how, when, the address and notes decrypted ("(could not
be decrypted)" otherwise). One button for the next step (`Change`): anyone
in the company (read again FOR SHARE); the status checked in the UPDATE (a
second press finds it changed); the customer's short fixed message
(`StatusText`) saved in the same transaction as a person's message that
doesn't take the conversation over, only when the chat may take one now;
otherwise the status still changes and the page says why. Served by core's
API ([api](api.md)); the page itself still calls the old backend until the
screens switch (phase 7). `CountNew` is Home's "N new orders".
