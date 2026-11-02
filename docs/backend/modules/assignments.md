# assignments (core/internal/assignments)

**What:** the `ticket.assigned` job: emails a person that a ticket is now
theirs (the old `services/assignment-notifications.ts`).
**How:** `tickets.QueueAssignedEmailWithin` queues it in the assignment's own
transaction (routing, and a person assigning someone else). The job
reads the ticket again: only while it is still open and assigned to exactly
that person, and only while they can take tickets (confirmed address, not
removed: an unconfirmed address may not be theirs). The email holds the
number, the subject (one plain line) and the category only; "because you
handle <category>" only when they do. The job's id is the idempotency key.
**Tests:** `assignments_test.go` (live database): routing queues it; one email
with number, subject and category, never the customer; someone removed
since hears nothing.
