# jobs (core/internal/jobs)

**What:** core's job queue in PostgreSQL (`core_jobs`): work that must survive
a restart (answer a customer, send a post).
**How it works:**
- `Enqueue(company, NewJob{Kind, Payload, RunAfter, MaxAttempts, DedupeKey})`,
  or `EnqueueWithin(tx, ...)` inside the transaction of the work that needs
  it (a handover's alert exists only if the handover does).
  Payloads hold ids only, never a customer's words. A `DedupeKey` waiting or
  running for the same company makes the second `Enqueue` `ErrDuplicate`.
- A `Worker` claims one due job at a time (`FOR UPDATE SKIP LOCKED`: several
  workers never take the same job), runs its kind's `Handler`, and marks it
  done, or queues it again after a growing wait (30 s, 2 min, 8 min, 32 min,
  then every 2 h) until its tries are used up. A `*Failure{Permanent: true}`
  stops it at once. A panic is a failed try, not a dead worker.
- Several workers run side by side (`cmd/core` starts 4). Stopping the
  service stops the claiming, never a job halfway: a running job keeps its
  own time (its lease), and its done/failed mark is still written.
- A job of a kind nobody handles fails at once (`unknown_kind`).
- A job running longer than its lease (10 minutes) was cut off (a deploy, a
  crash): it is queued again, code `interrupted`.
- Failures are stored and logged as codes only.
**Cross-company:** the claim and the hand-back read every company's jobs
(listed in `core/internal/database/CROSS_COMPANY.md`); the job then runs with
its own company.
**Tests:** `jobs_test.go` (live database): a job runs once and is done; a
failed try waits, a permanent one stops; a dedupe key waits once; the backoff.
