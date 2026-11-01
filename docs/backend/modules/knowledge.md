# knowledge (core/internal/knowledge)

**What:** the company's knowledge base as far as core uses it today (the
old `db/knowledge-search.ts`, `lib/knowledge/search-query.ts`,
`lib/knowledge/prompt-slice.ts`): searching the company's APPROVED articles
for one audience, and the escaped `<article>` blocks the AI reads. Writing,
approving, archiving and importing articles (documents, web pages), the
Knowledge page and "Test what the AI finds" move with the Knowledge page.

**The query (`BuildTsQuery`, pure):** what someone asked becomes OR-ed
words for `to_tsquery('simple', ...)`: runs of letters, marks and digits
only (no operator or quote of Postgres's gets through), NFKC and
lower-cased (as the index holds them), 2-100 characters, a short English
stop list, each word once, at most 20, 4+ letters matched as a prefix
("refund" finds "refunds"). No word left = no search runs. It goes to
Postgres as a parameter, never as SQL text.

**The search (`Search`):** the company first, on both tables; approved
only; the audience's flag ("support" or "marketing"); best first
(`ts_rank_cd`: title words count most), at most 2 pieces of one article,
1-10 hits.

**The slice (`Slice`):** the best hits first, each whole in its own
`<article title="...">` tags with title and text escaped (so nothing an
article says can close the tag or open another), while they fit; the first
that doesn't fit is left out with everything after it, so the AI never
reads half a piece. Lengths are counted as the old JavaScript did (UTF-16),
so both backends keep the same hits.

**In the assistant ([assistant](assistant.md)):** `Inputs.AddKnowledge`
searches the support articles for the customer's newest message (in a
real reply and in "Try your assistant") and gives the brain the best 3,
within 3,000 characters; their texts count as the owner's own words for
ansa's checks (a price or a link an article states may be quoted).

**Tests:** `search_test.go` (only words reach the query, NFKC, at most 20;
only the company's approved support articles are found, never a draft, a
marketing-only one or another company's; the slice escapes and never
cuts a piece); `assistant/reply_test.go` (an approved article reaches the
brain and its price may be quoted).
