# autopost: "Post for me" (core/internal/autopost, brain/brain/posts/autopost.py)

**What:** ansa plans, writes and posts on the business's Facebook Page by
itself, every day, three times a week or weekly, at the owner's local time
(the old `lib/autopost/`, `services/autopost*.ts`, `db/autopost.ts`). The
owner never gives it a topic.

**The topic brain (`brain.go`, pure, in core: rules and numbers, not an
AI):** a special day on its date, once (a short fixed list: New Year's Day,
Valentine's Day, Women's Day, Halloween, Christmas Eve and Day, New Year's
Eve; days whose dates move aren't in it). Otherwise the kind with the best
score: its share of the mix (food businesses: spotlight 4, behind the
scenes 2, a question 2, come and see us 2, a tip 1; others: spotlight 3,
tip 3, behind the scenes 2, question 1, come and see us 2), times how its
posts did (reactions + comments + shares of each post's newest numbers,
against the average, 0.5 to 2), times 1.5 for "come and see us" on
Thursday and Friday, divided by 1 + 2 x its uses in the last 3 posts. A
spotlight is about the item spotlighted least recently (never first, in the
menu's order); none without items.

**Posting times (`times.go`, pure):** the posting days of the frequency
(daily; Monday, Wednesday, Friday; Friday) at "HH:MM" in the business's
time zone, at most 15 days ahead. A time a clock change skips moves past the
jump; a repeated one takes the first. A post is written up to a day before
its time, so the owner sees it coming and can cancel it.

**Writing (`writer.go`):** the posting time is CLAIMED first
(`autopost_slots`, unique company + post_at: two runs write it once). No
connected Facebook Page = skipped "no_page"; the business's own key saved
but unreadable = "no_ai" (ansa's key is never used in its place). The brain
(`POST /v1/posts/write`, with the company's engine: its own key, ansa's, or
Claude Code in development) gets the business's own details only: name,
kind, about, address, hours, up to 40 offers ("Margherita | €9.50 |
Tomato and mozzarella"), the owner's instructions and words to avoid, the
newest 5 posts' first lines, the topic brain's choice and the day; every
value escaped in its tag, card-like numbers hidden; no id, account or
customer. Every list goes as a list, empty when there is nothing (the brain
reads the request strictly: no words to avoid sent as null was refused,
and no post was ever written, until step 58). Its answer is strict (`body`, `call_to_action`, `hashtags`: a
body empty or over 1,500 characters is unusable; the call to action one
plain line of at most 200; at most 4 hashtags of letters, digits and _).

**ansa's checks (`checks.go`):** the assistant's reply checks on the
whole published text (every amount with a currency mark a listed price or
in the owner's own words, no refund words, every link the owner's own);
every percentage and every discount, promo or coupon word the owner's own;
Facebook's rules (length, 10 hashtags, words to avoid). A text they stop
gets one more try on another kind of post; still stopped = skipped
"checks_failed"; the AI failing both = "ai_failed"; no AI = "no_ai".

**Saving:** a kept post is a draft in the name of the owner who switched it
on (no claims: ansa's checks replace them; their being an owner is read
again: not any more = "not_owner"), then in Automatic it is scheduled for
its time on every connected Page without an approval, under the owner's
Facebook "any pillar" auto-publish rule ([publishing](publishing.md): its
run-time checks, retries and activity log apply). Ask me first, or a queue
that refuses it (the rule switched off meanwhile), leaves it waiting for an
owner's approval.

**The switch (`switch.go`):** owners only (the company row lock, then the
role read again; settings-changes limit). Switched on, it needs the
business's time zone, and records who and when. Automatic needs the owner's
tick ("ansa may post without asking me each time") and then switches the
company's Facebook "any pillar" rule on in the owner's name
(`publishing.SetAnyPillarRule`, made switched off first when missing: only
an owner's explicit switch turns one on); Ask me first or off switches it
off. Off also takes back the posts still on their way (archived:
`publishing.ArchiveDraft` cancels their waiting posts; one already out
stays) and marks them "stopped".

**Runs:** core's scheduler runs `RunDue` every minute (every company with it
on, the one cross-company read in CROSS_COMPANY.md: ids and these settings
only; at most 10 posts a round; one company's failure is logged and the
round goes on). "Post one now" (owners, 5 an hour per company) writes one
for this moment; the queue sends it within seconds.

**API ([api](api.md)):** `GET /api/v1/settings/posts` (everyone: the switch,
the Pages by name, the next three times, the newest 20 posts with where
each is, why one was skipped, and its reactions + comments + shares),
`POST /api/v1/settings/posts` `{enabled, frequency, time, mode, understood}`
(owners), `POST /api/v1/settings/posts/now` (owners; waits up to 270 s).

**Logging:** "post for me: the AI failed / not scheduled" with a code
only; never the post, the prompt or the AI's answer.

**Tests:** `autopost_test.go` (the topic brain's choices, posting times
across clock changes, made-up prices, percentages, coupons, words to avoid
and Facebook's hashtags stopped); `writer_test.go` (live database, a fake
brain: Automatic writes Wednesday's post once on Tuesday, queues it at
11:00 in Rome under the owner's rule with only the business's details sent,
switching off takes it back and switches the rule off; a made-up price is
tried once more on another kind, then skipped with nothing saved; Ask me
first leaves a draft for the owner; no AI is said); `api/posts_test.go`;
`brain/tests/test_posts.py` (the prompt escapes and hides numbers, the
answer is strict and cleaned, no model = nothing written, an unknown field
refused).

**Packages (step 57, [packages](packages.md)):** Personal has no "Post for me", Business posts up to 3 times a week, Pro every day (a frequency the package doesn't include is refused when saving, and a post skipped as `package` after a downgrade); each post written with ansa's AI is one of the month's AI replies (the business's own key isn't counted), and with none left the post is skipped.
