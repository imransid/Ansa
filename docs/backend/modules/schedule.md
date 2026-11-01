# schedule (core/internal/schedule)

**What:** core's periodic work, run inside the service (the old backend
needed outside cron calls: once a day on Vercel's free plan, every minute
only with Vercel Pro or a pinger).
**How:** `schedule.Run(ctx, log, tasks)`: each `Task{Name, Every, Run}` on its
own beat until the service stops; a failure is logged with its class only, a
round that did something logs how many. Several core processes may run the
same tasks: each task claims its work in the database (`FOR UPDATE SKIP
LOCKED`), so nothing is done twice.
**Tasks today (`cmd/core/main.go`):** the assistant's catch-up, every 15 s.
Publishing, post numbers, "Post for me" and the daily cleanup join as their
modules move.
