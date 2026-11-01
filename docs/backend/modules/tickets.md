# tickets (core/internal/tickets)

**What:** making and routing requests ("Needs you"), as the old
`db/ticket-creation.ts` and `db/routing.ts`. So far: a chat request the
assistant opens when it hands a conversation to a person.
**Rules:**
- The caller's transaction takes the company row lock FIRST
  (`LockCompanyWithin`): numbering and routing run one at a time per company.
- The number: `companies.last_ticket_number + 1`, in the same transaction.
- The category is followed by its id (read `FOR KEY SHARE`): renamed meanwhile
  = the new name; archived or another company's = none.
- Routing by category: the expert who handles it, can take tickets
  (confirmed address, not removed), with the fewest open tickets (ties: who
  joined first); assigned automatically, `routed_to_user_id` kept as
  routing's first pick, and a `routed` history row with the category. A chat
  request has no phone or email, so same-customer routing never applies to it.
**Tests:** `tickets_test.go` (live database): the least busy confirmed expert
gets it; no category = unassigned; numbers follow; the history row.
**Still on the old backend:** typed-in tickets, call and email tickets,
same-customer routing, reassigning, solving, notes and history pages (Phase 5).
