# requests (core/internal/tickets: list.go, detail.go, changes.go)

**What:** requests ("Needs you" tickets) as people work them (the old
`db/tickets.ts`, `db/ticket-filters.ts`, `db/ticket-updates.ts`,
`db/ticket-solving.ts`, `db/ticket-reopening.ts`, `db/ticket-activity.ts`,
`services/tickets.ts`, `services/conversation-done.ts`). Everyone in the
company works requests; only owners reopen.
**The list (`GET /api/v1/requests?view=&q=&page=`):** views open, mine
(always the session's own person), unassigned, solved, all (members land on
mine, owners on open); 50 a page, newest number first; the counts of every
view with the same search. The search finds the text anywhere in the
subject, the customer's name, email or phone, or the address the original
email came from (ILIKE with `% _ \` escaped; every value a parameter), a
phone number however written (3+ digits), and "#57" or "57".
**A request (`GET /api/v1/requests/{number}`):** its fields, who solved it
and how, who set the customer's email, its newest 200 history entries oldest
first (notes decrypted with `ticket-note:<company>:<ticket>:<note>`), the
people it can be given to (confirmed, not removed) and the categories.
**Changes (120 per 10 minutes per person; each with its history row in the
same transaction):**
- `POST .../{id}/assign {"assigneeId": "" | id}`: the person read in the
  UPDATE itself (FOR SHARE: a removal at that moment is waited for, then
  refuses); the same assignee again changes nothing; whoever gets it is
  emailed unless they took it themselves.
- `.../category {"category"}`: an active category of the company; an open,
  unassigned request is then routed (also when the category is unchanged:
  how a request goes back to routing), and the expert emailed; a rename at
  that very moment is refused by the foreign key.
- `.../notes {"text"}`: 1-5,000 characters, encrypted, in ONE statement that
  writes only when the request is this company's.
- `.../close`: solved without emailing the customer (spam, a "thanks").
- `.../reopen` (owners): who solved it is cleared; an assignee who left goes
  back to routing.
- `POST /api/v1/conversations/{id}/done {"ticketId"}`: "Done" on a chat's
  request: closed without an email, then the conversation handed back to
  ansa (two transactions: a refused hand back leaves it closed).
Every change takes the company row lock first when it may route.
**Tests:** `api/requests_test.go` (live database): the searches (#7, a phone
written differently, "100%" as text, nothing); owners land on open; the
category routes to its expert and queues the email; taking it yourself
emails nobody; a made-up person refused; a note decrypted in the history;
Done closes without an email; closing twice refused; an owner reopens.
**Next (part B):** solving with the customer's "solved" email (the outbox,
delivery, Retry), setting the customer's email with its confirm step,
editing the subject or name, a request typed in.
