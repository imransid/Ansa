# cofounder: the Co-Founder Overview (core/internal/cofounder)

**What:** the Co-Founder's Overview page (the old
`services/cofounder-overview.ts`, `db/cofounder-progress.ts`,
`lib/cofounder/getting-started.ts`): how complete the business profile is
([profile](profile.md)), what an owner should do next, where the marketing
plan stands ([strategy](strategy.md)), and the Getting started checklist.
Real counts and real state only; nothing written.

**The checklist (`checklist.go`, pure):** seven steps in the order a
business works through them, each done or not, what was found in words and
its page: answer the interview (finished as the Overview says it: no key
topic missing), confirm the key facts (all 16), make a plan, write a first
draft (one holding anything: an idea holds nothing), connect an account
(connected as of now; a development stand-in counts and says so; one whose
access ended with nothing to renew it counts as needing a reconnect), schedule a
first post (any post not canceled), see how posts did (any numbers, simulated
ones too).

**Next steps (owners only):** confirm the proposals waiting, then start or
continue the interview while a key topic has nothing (naming 3 and "N
more"), then, with every key fact confirmed and nothing waiting, review the
profile.

**Reads (`overview.go`):** each step a yes/no Postgres answers from the
first row it finds, the company first in every WHERE.

**API ([api](api.md)):** `GET /api/v1/cofounder/overview` →
`{completion: {keyConfirmed, keyTotal, proposalsWaiting}, missingKeyTopics: [{topic, label}], interviewStarted, interviewFinished, nextSteps: [{label, href, description}], strategy: {currentPlan: {version, createdAt} | null, missingForPlan: [{label, topics}]}, checklist: [{key, label, done, status, href}]}`.

**Tests:** `overview_test.go` (the checklist follows the company's state
step by step; an idea is no written draft; an account whose access ran out
needs a reconnect; another company's progress never counts; next steps for
owners only); `api/cofounder_calendar_test.go`.
