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
people it can be given to (confirmed, not removed) and the categories. Each
history entry names who did it and who it was about (the wording tells "took
it" from "gave it to Ana"), a note that can't be decrypted says so
(`noteUnreadable`), and `olderEntriesHidden` says when there are more than
200. Also: its newest customer email with what Resend reported after
sending (`deliveryProblem`), the email it came from (`originalEmail`:
sender, verified or not, Reply-To, subject and body decrypted, attachments
named, "could not be decrypted" said), the same customer's other open
requests (the newest 20, by phone digits or address), and up to 3 approved
support articles matching its subject and category (`relatedKnowledge`).
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
**Solving with the customer's email (`tickets/solve.go`, `core/internal/outbox`):**
`POST .../{id}/solve {"confirmedCustomerEmail"}` ("" when the page showed
none): the UPDATE requires the request to still have exactly that address,
so the email never goes to one the person didn't see. The "solved" email is
an `outgoing_emails` row AND its delivery job, written in the solve's own
transaction. The job delivers it right away and tries a failed send twice
more within minutes (safe: the row id is Resend's idempotency key; the old
backend never retried on its own). A delivery claims the row in ONE UPDATE
(two never both send), only for the request's current solve that was meant
to email; "failed" only over "sending", "sent" also over "failed". 300 a day
per company (a held-back email says so, and Retry works later). The email is
fixed text with the request number and the company's name only, never the
customer's name or the subject; replies come back to the company (its
reply-to, else its forwarding address).
`POST .../{id}/emails/{email}/retry {"confirmPossibleDuplicate"}`: anyone;
from 23 hours after the first try it needs the person's "send it again
anyway?". The page reads the newest email (`latestEmail`: its status, why it
waits, whether a delivery is under way, whether a Retry needs confirming).
**The customer's email (`.../customer-email`):** `{"email", "confirmed":
false}` answers the cleaned-up address to confirm ("Solved emails for this
request will go to ..."); `confirmed: true` saves exactly it, recording who
entered it (`core/internal/addresses`: the browser's type="email" rule, an
international domain converted to ASCII with `golang.org/x/net/idna`, a dot
in it, at most 254).
**Edits (`.../details`):** the subject (one plain line, 1-200) and the
customer's name with what the editor opened with: only a field the person
changed is written (a teammate's change to the other stays), one history
row each.
**A request typed in (`POST /api/v1/requests`):** subject, description
(1-10,000), name, phone (up to 40), a customer email that needs the confirm
step, a category by id (renamed = followed); 30 per 10 minutes per person;
a "created" row, then routing as every new request: the same customer's
open request's expert first (the phone compared by its digits, at least 7,
never a hidden caller's placeholder like ANONYMOUS's; or the same email),
else by category; whoever gets it is emailed (never its own creator).
**More tests:** `api/requests_more_test.go` (the confirm step; a solve refused
for an address the person didn't see; the solve queues the email and its
job; the fixed email names the number, never the subject, with the
forwarding address as Reply-To; Retry after it went refused; only the
changed field is written; a new request needs its address confirmed);
`tickets_test.go` (hidden callers and repeats are nobody; the same digits
go to the expert who has the customer's open request).
