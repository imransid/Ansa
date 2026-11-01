# profile: the business profile and the interview (core/internal/profile, brain/brain/cofounder/)

**What:** what the Co-Founder knows about the business, topic by topic
(the old `lib/business-facts.ts`, `lib/cofounder/`, `db/business-fact*.ts`,
`db/onboarding-messages.ts`, `services/business-profile.ts`,
`onboarding-*.ts`, `fact-suggestions.ts`), the interview that fills it, and
"Suggest facts from knowledge". Tables: `business_facts`,
`onboarding_messages` (no migration: the old schema).

**Topics (`topics.go`, `status.go`, pure):** 25 topics in the interview's
order (the database's CHECK lists the same keys), 16 of them key facts,
each with a label, a Profile page group and one fixed question. Per topic a
value an owner confirmed (who, when, from where: interview, owner or
knowledge) and BESIDE it a proposal (from the interview or knowledge). The
completion ("12 of 16") counts confirmed key facts only; for the interview
a proposal counts as answered.

**Rules (`store.go`, `values.go`):**
- A proposal NEVER overwrites a confirmed value. One equal to the
  confirmed value or to the proposal waiting writes nothing; rows are
  written in the topic list's order (two saves at once can't deadlock).
- Only owners change it: checked in the API AND inside the write's
  transaction, the person read again FOR SHARE (`team.RoleWithin`; an owner
  made a member meanwhile is refused). Members read.
- Every change names what the page showed: Confirm (the proposal AND the
  fact beside it), Edit and confirm (the source becomes "owner"), Dismiss
  (the proposal), Edit / Fill in (the value the editor opened with). Changed
  meanwhile = "stale", nothing written; two first saves at once: the later
  one is stale. Typing what waits clears the proposal.
- Values: 1-2,000 characters (UTF-16, as the old code counted; a line
  break counts once, stored as \n), no control characters but line breaks
  and tabs.

**The interview (`interview.go`, `messages.go`, `reply.go`, `brain.go`):**
messages encrypted with the old context `onboarding-message:<company>:<message>`
(so both backends read each other's rows; a copy in another company is
unreadable). The first question is fixed text, saved with the first answer
as the page showed it (`openingTopic`); an answer to a conversation started
over meanwhile is refused. Each answer is saved first, then the brain
(`POST /v1/cofounder/interview-turn`) reads the 25 topics with their values
and the newest 12 messages, and proposes facts and the next question.
Core checks the turn (known topics, cleaned values, the question one plain
line of at most 500) and decides the reply: the AI may end the interview
only when no key topic is missing counting its proposals, else the fixed
question of the missing one; without a usable turn, `CouldNotReadNote`
plus the fixed question of the first missing key topic. The reply and its
proposals are saved in ONE transaction, only while the answer still
exists. Every answer, reply and Start over takes the company row lock
first, then the person: they run one at a time per company. Start over
deletes the messages, never the facts. "Finished" = ansa's newest message
closed it AND no key topic is missing now.

**Suggestions (`suggestions.go`):** an approved article of the company,
ticked for support or marketing; a draft, an archived one, one ticked for
neither or another company's is refused before the brain is asked. Core
sends the article's first whole pieces in escaped `<article>` tags within
10,000 characters (`knowledge.Slice`); the brain
(`POST /v1/cofounder/fact-suggestions`) proposes facts, saved as proposals
(source knowledge) while the person is still an owner.

**The brain (`brain/brain/cofounder/common.py`, `interview.py`,
`suggestions.py`):** the old prompts word for word. Every value escaped in
its tag; card-like and social-security-like numbers hidden (email addresses
stay: the business's own is a fact); facts cut at 300, older messages at
1,000, the newest answer read whole; a cut never splits an emoji and is
marked "[... N characters left out ...]". No company, person or id. The
answers are strict (an extra field = unusable); `proposed_facts` entries
drop one by one. Settings: interview effort low, 3,000 tokens, 40 s, one
retry; suggestions effort medium, 4,000 tokens, 45 s, one retry.

**API ([api](api.md)):**
- `GET /api/v1/cofounder/profile` → `{profile: {groups: [{group, label, topics: [{topic, label, isKey, confirmed: {value, source, at, byName} | null, proposal: {value, source, at} | null}]}], completion: {keyConfirmed, keyTotal, proposalsWaiting}, missingKeyTopics: [{topic, label}]}, canManage, articlesForSuggestions: [{id, title}]}` (the articles for owners only).
- `POST /api/v1/cofounder/profile/confirm` `{topic, shownProposal, shownConfirmedValue, value?}` → `{outcome: "changed"}`; 409 stale.
- `POST /api/v1/cofounder/profile/dismiss` `{topic, shownProposal}` → `{outcome}`; 409 stale.
- `POST /api/v1/cofounder/profile/edit` `{topic, value, originalValue}` → `{outcome: "changed" | "unchanged"}`; 409 stale; 400 `fields.value`.
- `POST /api/v1/cofounder/profile/suggest` `{articleId}` → `{outcome: "saved", proposedTopics: [{topic, label}], readWholeArticle}`; 404 not an approved article of the company; 409 ticked for neither; 502 the AI couldn't read it.
- `GET /api/v1/cofounder/interview` → `{interview: {messages: [{id, author, authorName, text | null, unreadable, createdAt}], olderMessagesHidden, opening: {topic | null, text} | null, finished}, canAnswer}`.
- `POST /api/v1/cofounder/interview/answer` `{answer, openingTopic?}` (`openingTopic`: a topic key or "none", sent only while the page shows the first question) → `{outcome: "saved", proposedTopics, aiReadAnswer, fixedQuestionTopic: {topic, label} | null}`; 409 started over meanwhile.
- `POST /api/v1/cofounder/interview/start-over` → `{outcome: "started-over"}`.

Owners only for every POST (403 otherwise). Limits (the old counters):
`business-profile-changes` 120 per 10 minutes per person (confirm, dismiss,
edit, Start over), `onboarding-turns` 60 an hour per company,
`fact-suggestions` 20 an hour per company.

**Logs:** fixed lines with the model error's class only ("interview: the AI
failed", "fact suggestions: the AI failed", "could not decrypt stored
text"); never an answer, a question, a fact or an error's message.

**Tests:** `facts_test.go` (topics and completion; a proposal never over a
fact, Confirm keeps its source, Edit and confirm records the owner; stale
changes write nothing; members, an owner made a member and other
companies change nothing; cleaning and cutting as the old code counted);
`interview_test.go` (the opening, the answer and the reply with its
proposals; without the AI the fixed question; the interview ends only with
no key topic missing, and opens again when one is missing; the brain reads
only the newest 12; encryption context; Start over, a lone reply never
saved, members); `suggestions_test.go` (proposals only, the escaped
article; what no AI may read is refused without asking; a failed answer and
a long article); `api/cofounder_profile_test.go`;
`brain/tests/test_cofounder_profile.py` (escaping, card numbers, emoji
cuts, strict answers, settings, signed endpoints).
