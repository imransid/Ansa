# alerts (core/internal/alerts)

**What:** the `owner.alert` job: tells a business's owners that a
conversation needs them (the old `services/owner-alerts.ts`).
**How:** queued by the handover in its own transaction, it starts 20 s later
(after the holding reply's send had its time), then:
- at most 60 alerts an hour per business (`owner-alerts`, the old counter);
- an email to each confirmed, active owner while "alert by email" is on
  (`texts.go`, the old `lib/emails/needs-you.ts`): who (the name as the
  channel gave it, one plain line of at most 60), where, why (worded for
  the account's kind: a person has no menu), whether the
  holding reply reached them, and a link to the conversation. The job's id
  makes each email's idempotency key, so a retried job never emails twice;
- a note from ansa's bot in the business's own Telegram, when a real bot is
  set up and a real account is connected.
An important person who writes again while their request is still open
(`wroteAgain`, queued at once: no holding reply to wait for) is alerted
again: "<name> wrote again on <channel>", saying that ansa didn't reply
again.
**`comment.alert`** ([comments](comments.md), `comments.go`): a comment on
the business's Facebook post that a person follows up (a complaint, or ansa
unsure), 20 s after its answer was saved: "<name> needs you about a comment
on your Facebook post", why, what reached the commenter (the public note,
the holding reply in Messenger) and a link to their Messenger conversation,
else to the request. The same hourly limit, emails and Telegram note.
Never the customer's messages or comments. Best effort: a send that fails is logged as a
code and never undoes the handover.
**Tests:** `alerts_test.go` (live database): one email, to the confirmed owner
only, with who, where, why and the link, never the message; none while
"alert by email" is off; an important person writing again is said so.
`comments_test.go`: a comment's alert says who, why, what reached them and
where, never the comment; another company's job finds nothing.
