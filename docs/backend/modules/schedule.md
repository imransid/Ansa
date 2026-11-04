# schedule (core/internal/schedule)

**What:** core's periodic work, run inside the service (the old backend
needed outside cron calls: once a day on Vercel's free plan, every minute
only with Vercel Pro or a pinger).
**How:** `schedule.Run(ctx, log, tasks)`: each `Task{Name, Every, Run}` on its
own beat until the service stops; a failure is logged with its class only, a
round that did something logs how many. Several core processes may run the
same tasks: each task claims its work in the database (`FOR UPDATE SKIP
LOCKED`), so nothing is done twice.
**Tasks today (`cmd/core/wiring.go`, `scheduledTasks`):** the assistant's
catch-up, the phone app's presence watcher ([devices](devices.md): away
when no owner's phone was reachable) and the publishing queue
([publishing](publishing.md)), each every 15 s; "Post for me" ([autopost](autopost.md)) every minute; post numbers
([postmetrics](postmetrics.md)) every 5 minutes; stuck image and video
requests ([mediagen](mediagen.md)) every minute; the cleanup
([maintenance](maintenance.md)) every hour. Emails and calls need no task:
their jobs try again by themselves ([jobs](jobs.md)).
**Switched off:** `CORE_SCHEDULER=off` starts no periodic task (a second
core beside a running one, or a preview of the screens).
