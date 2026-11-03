# tickets (core/internal/tickets)

**What:** making and routing requests ("Needs you"), as the old
`db/ticket-creation.ts` and `db/routing.ts`. So far: a chat request the
assistant opens when it hands a conversation to a person, and one about a
comment on the business's Facebook post ([comments](comments.md)), which
starts without a conversation (`ConversationID` "") and becomes the
commenter's Messenger conversation's once ansa's private reply opened it.
**Rules:**
- The caller's transaction takes the company row lock FIRST
  (`LockCompanyWithin`): numbering and routing run one at a time per company.
- The number: `companies.last_ticket_number + 1`, in the same transaction.
- The category is followed by its id (read `FOR KEY SHARE`): renamed meanwhile
  = the new name; archived or another company's = none.
- Routing by category: the expert who handles it, can take tickets
  (confirmed address, not removed), with the fewest open tickets (ties: who
  joined first); assigned automatically, `routed_to_user_id` kept as
  routing's first pick, and a `routed` history row with the category.
- A request from a live call carries the caller's number
  (`NewChatTicket.CustomerPhone`), so same-customer routing comes first for
  it, as for every new request (`routeToSameCustomerWithin`): whoever has
  that caller's other open request (the same digits) gets it, whatever its
  category, with a `routed` row naming no category; and later requests with
  that number follow it. A chat request has no phone or email, so it goes by
  category only.
- Whoever routing picks is emailed: `QueueAssignedEmailWithin` queues the
  `ticket.assigned` job in the same transaction (see
  [assignments](assignments.md)).
**Tests:** `tickets_test.go` (live database): the least busy confirmed expert
gets it; no category = unassigned; numbers follow; the history row; a
caller's request goes to the expert of their other open request, emailed.
`assignments_test.go` covers the email the routing queues.
**People's work on requests:** see [requests](requests.md).
**Typed-in tickets, solving with the customer's email:** [requests](requests.md);
**call and email tickets:** [calls](calls.md), [email-in](email-in.md).
