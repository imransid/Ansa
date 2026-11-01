# studio: the content studio (core/internal/studio, core/internal/drafts, brain/brain/content)

**What:** the Co-Founder's drafts: one post for one platform and format
(the old `services/content-*.ts`, `db/content-draft*.ts`,
`lib/content-studio/`). A person writes or edits; the AI writes or
rewrites through the brain; owners approve and reject; anyone archives and
restores. Publishing them is [publishing](publishing.md); their image or
video is [media](media.md).

**Drafts (`core/internal/drafts`, shared with the queue and the media
library):** `fields.go` (what a draft holds, its limits, which status each
change may start from, `KeepUsedFields`: a title only on YouTube, a script
only on a video, no image description on a text post), `topics.go` (the
profile's 25 topics with their labels, what the AI needs confirmed first),
`review.go` + `claimcheck.go` (`ReviewDraft`: the platform's rules from
[contentrules](contentrules.md), each claim backed / no_fact /
fact_not_confirmed / fact_changed against the facts sent and the facts now,
and whether "I checked these claims" is needed: a claim not backed, or a
text the AI didn't write as it is now), `list.go` (a page of 50, last
changed first, and the counts per filter), `detail.go` (one draft with who
made, changed, approved and rejected it; `LockContentWithin`).

**Rules (`core/internal/studio`):**
- Every write reads the person's role again FOR SHARE (team.RoleWithin),
  then locks the draft FOR UPDATE; anyone active writes, edits, archives and
  restores; only owners approve and reject (an owner made a member meanwhile
  is refused).
- Every change of content is the next version and clears the approval and
  the tick IN THE SAME UPDATE, which names the version the page showed
  (changed since = 409 "stale"; of five saves at once exactly one wins). An
  edit changing nothing is "unchanged" (the approval stays). The change
  cancels the draft's waiting posts and records it
  (publishing.CancelQueuedAfterChangeWithin), in its transaction.
- Approve checks the rules and the claims on the stored row and the facts
  now, inside the transaction that writes: a blocking issue refuses it; a
  claim not backed needs the tick, recorded with the approval. An approval
  by an owner made a member or removed since may be replaced by another
  owner's. A draft the queue has keeps the queue's status.
- Reject keeps its note through edits until an approval; it and Archive
  cancel waiting posts. Restore makes a draft (an idea when empty).
- The AI (`generate.go`): never asked before "What the business does",
  products or services, and target customers are confirmed; 30 drafts an
  hour per company ("content-generations"); Regenerate is refused BEFORE the
  AI is asked when the draft is archived or its page shows an older version,
  and the AI's text is never saved over an edit made while it wrote. A
  failed, refused or unusable answer saves nothing.
- The brain gets (`inputs.go`) the platform's rules, format, topic, the
  plan's pillar and campaign (with their details while the newest plan has
  them; read with SQL from `marketing_plans`), its positioning and
  audiences, the confirmed facts only (in the topics' order), the words to
  avoid, and up to 4,000 characters of approved MARKETING articles found by
  the topic, pillar and campaign words taken in turns. No id, account,
  person or support data. Core cleans and cuts its texts (`answer.go`,
  `text.go`: lengths counted as the old JavaScript did) and marks the
  claims: supported only when every topic named was confirmed and sent.
- `brain/brain/content/`: the old prompt word for word (every value escaped
  in its tag, card-like numbers hidden), the JSON schema, and a strict read
  (exactly the fields asked for, at most 30 claims, no "supported"). AI
  settings: effort medium, 12,000 tokens, 120 s a try, 1 retry
  (`ai.CONTENT_DRAFT`); ansa's own key only.

**API** (every request signed by the screens with a session; errors are
`{"error"}` or `{"error", "fields"}`):
- `GET /api/v1/cofounder/drafts?status=current|idea|draft|approved|rejected|scheduled|published|failed|archived&platform=all|linkedin|facebook|x|youtube&page=n`
  → `{drafts: [{id, topic, platform, format, status, version, updatedAt, updatedByName}], counts: {current, idea, ...}, status, platform, page, pageSize}`.
- `GET /api/v1/cofounder/drafts/new` → `{missingForAi: [labels], planChoices: {planVersion, pillars, campaigns}}`.
- `POST /api/v1/cofounder/drafts` `{platform, format, topic, pillar, campaign, withAi}` → `{draftId}` (blank: 120 changes per 10 minutes per person; withAi: waits for the AI, 422 with why when nothing was written).
- `GET /api/v1/cofounder/drafts/{id}` → `{draft: {id, platform, format, status, topic, pillar, campaign, version, generatedVersion, plannedFor, fields: {title, body, hashtags, callToAction, imagePrompt, videoScript}, editedByHand, createdAt, createdByName, updatedAt, updatedByName, approval: {at, byName, version, claimsChecked, byActiveOwner} | null, rejection: {at, byName, note} | null, review: {issues, blockingIssues, claims: [{text, status, facts: [{topic, label, value}]}], claimsState, acknowledgmentNeeded, wordsToAvoid}, madeFrom: {facts, knowledge: [{articleId, title}], planVersion} | null, businessName, planChoices, media: (see [media](media.md))}, canReview}`.
- `POST .../{id}/edit` `{version, topic, pillar, campaign, title, body, hashtags (as typed), callToAction, imagePrompt, videoScript}` → `{outcome: changed | unchanged}`.
- `POST .../{id}/regenerate` `{version}` → `{outcome, draftId}` (waits for the AI).
- `POST .../{id}/approve` `{version, claimsChecked}` (owners) → `{outcome: approved | unchanged}`; 422 blocked or claims not checked.
- `POST .../{id}/reject` `{version, note}` (owners) → `{outcome}`.
- `POST .../{id}/archive`, `POST .../{id}/restore` `{}` → `{outcome}`.
- 404 unknown draft, 403 not allowed, 409 stale or wrong status, 429 too many changes.

**Tests:** `studio/studio_test.go` (an approval records its version and an
edit takes it away; five edits at once, one wins; members can't decide; the
tick; a rejection's note; archive and restore; another company finds
nothing), `studio/generate_test.go` (fake brain: the key facts first, the
AI's text cleaned and its claims marked by core, nothing saved on a
failure, Regenerate never asks for an older page nor saves over an edit,
the hourly limit), `studio/forms_test.go`, `drafts/claims_test.go`,
`api/cofounder_studio_test.go`, `brain/tests/test_content.py` (the
platform's rules in the prompt, escaping, schema and reader agree,
failures, settings, unknown fields refused).
