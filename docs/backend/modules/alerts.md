# alerts (core/internal/alerts)

**What:** the `owner.alert` job: tells a business's owners that a
conversation needs them (the old `services/owner-alerts.ts`).
**How:** queued by the handover in its own transaction, it starts 20 s later
(after the holding reply's send had its time), then:
- at most 60 alerts an hour per business (`owner-alerts`, the old counter);
- an email to each confirmed, active owner while "alert by email" is on
  (`texts.go`, the old `lib/emails/needs-you.ts`): who (the name as the
  channel gave it, one plain line of at most 60), where, why, whether the
  holding reply reached them, and a link to the conversation. The job's id
  makes each email's idempotency key, so a retried job never emails twice;
- a note from ansa's bot in the business's own Telegram, when a real bot is
  set up and a real account is connected.
Never the customer's messages. Best effort: a send that fails is logged as a
code and never undoes the handover.
**Tests:** `alerts_test.go` (live database): one email, to the confirmed owner
only, with who, where, why and the link, never the message; none while
"alert by email" is off.
