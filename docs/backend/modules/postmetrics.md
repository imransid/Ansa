# postmetrics (core/internal/postmetrics)

**What:** reading the numbers of published posts (the old
`services/post-metrics-collection.ts`, `db/post-metrics.ts`,
`adapters/facebook-metrics.ts`). Facebook Page posts' reactions, comments
and shares (what "Post for me"'s topic brain learns from:
[autopost](autopost.md)), and X's and YouTube's numbers through their
connectors (`others.go`: the account made ready by `social.Renewer.Prepare`,
then `platforms.Connectors.ReadNumbers`; skipped with the old codes when it
needs a reconnect, was disconnected, can't be read or got no answer to a
renewal). LinkedIn is never asked (its post numbers need a permission
ansa's app can't have). A post is read for `platforms.ReadDays` (30 days,
X's 28). The Analytics page and its review: [analytics](analytics.md).

**Snapshots:** each read is one `post_metrics` row, never changed; a
number the platform doesn't give is NULL (shown as not available), never 0.
Facebook gives no views, viewers or clicks here (those are Page insights:
read_insights, which ansa doesn't ask for).

**When (`collector.go`):** core's scheduler runs `RunDue` every 5 minutes,
at most 20 posts a round. A post is due when published 1 hour to 30 days
ago, with Facebook's id (one an owner marked published by hand has none),
on a real Page (never the development stand-in: its numbers come from
`pnpm simulate:post-metrics`), and not tried in the last 20 hours. It is
CLAIMED in ONE UPDATE (`metrics_attempted_at = now`, a scalar SKIP LOCKED
subquery, the longest waiting first; listed in CROSS_COMPANY.md);
`updated_at` is untouched (the queue sorts by it).

**One read:** the Page read for one call ([social](social.md): a Page
needing a reconnect = skipped "reauthorization_needed", a disconnected one
"account_disconnected", an unreadable token "account_unreadable", no Meta
app "not_set_up"; nothing asked); then ONE GET of the post
(`shares,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)`,
appsecret_proof, 15 s, at most 1 MB read, only the numbers read: never who
reacted or commented). Saved in one transaction: the snapshot and the error
cleared, or the code on the job (`metrics_error`, never a snapshot):
token_rejected (and the Page marked "needs_reauth" while it still holds
that token, with a "reconnect_needed" activity row), permission_denied,
rate_limited, invalid_request, server_error, timeout, network_error,
unexpected_answer, no_numbers. A count outside 0 to Postgres's integer is
an unexpected answer.

**Logging:** "post metrics: skipped / not collected" with a code only.

**Tests:** `collector_test.go` (live database, a fake reader: a post's
numbers read once, NULL for the one not given, not again within 20 hours,
a refused token kept on the job and the Page marked; a fake Graph API: the
three numbers read, an answer without numbers, a refused token, only a
post id asked for).
