# knowledge (core/internal/knowledge)

**What:** the company's knowledge base, Settings → "Saved answers" (the old
`db/knowledge-*.ts`, `services/knowledge*.ts`, `lib/knowledge/`): articles
the assistant may quote once an owner approved them, their search, and
imports from a stored document or a public web page.

**Articles (`articles.go`):** title one plain line of 1-200, body 1-20,000
(a line break counts once, stored as \n; no control character but line
breaks and tabs), a kind (faq, policy, product, guide, solution, document,
website), ticked for support and/or marketing. New ones are always DRAFTS
(`CreateDrafts`: the company row lock first, at most 1,000 per company;
imports owners only; a solved request's number becomes the source only
when it is a solved request of this company; a document locked FOR KEY
SHARE while its articles are saved, "source-gone" if deleted meanwhile).
Anyone edits a draft; only owners edit an approved article (it stays
approved, in their name); nobody edits an archived one (`CanEdit`). Every
edit and approval names the revision the page showed ("stale" otherwise:
nobody overwrites or approves words they didn't see). Owners approve
(draft → approved, who and when), archive, restore (back to a draft,
approval cleared) and delete (for good, its pieces too); a status another
owner changed meanwhile is "wrong-status". Every change of title or body
rewrites the pieces in the same transaction (`chunking.go`: whole
paragraphs up to 1,500 characters, a longer one cut after a sentence, else
a space, else anywhere).

**Imports (`imports.go`, `webimport.go`, owners, 20 an hour per company):**
a stored document's text (.txt/.md/.csv as UTF-8 without its byte order
mark; .docx: only its text part unpacked, at most 50 MB; .pdf through the
brain's `/v1/documents/pdf-text`, pypdf: a scanned PDF has no text) or one
public web page (only through [safefetch](safefetch.md); HTML made text,
its `<title>` as the name, else host and path), cleaned (one kind of line
break, no control characters, at most one blank line in a row), at most
200,000 characters, then cut into drafts of up to 20,000 at paragraph
boundaries titled "<name> (part 2 of 3)". Importing again makes new drafts.

**API ([api](api.md)):** `GET /api/v1/knowledge?status&q&page` (50 a page,
counts per status); `GET /api/v1/knowledge/articles/{id}` (with where it
came from, who wrote, changed and approved it, its pieces, and what this
person may do); `POST /api/v1/knowledge/articles` (anyone; `fromTicket`
for "Save as knowledge"); `.../{id}/edit` `{revision, ...}`; `.../{id}/status`
`{change, revision}`; `.../{id}/delete`; `POST /api/v1/knowledge/test`
`{question}` (exactly what the chat assistant reads, its pieces and the
text, and the one line the phone assistant hears; 30 a minute per
person); `POST /api/v1/knowledge/import/document` `{documentId}`; `POST
/api/v1/knowledge/import/web` `{url}` (the log names the fetch's code,
never the address). Writes: 60 per 10 minutes per person.

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

**Tests:** `articles_test.go` (pieces, import parts and cleaning; a
member's draft, a stale approval refused, an approved article found and
changed by owners only, restore only from archived, delete by owners);
`api/knowledge_test.go` (write, approve, the test search, a text document
imported, a private web page never fetched); `search_test.go` (only words reach the query, NFKC, at most 20;
only the company's approved support articles are found, never a draft, a
marketing-only one or another company's; the slice escapes and never
cuts a piece); `assistant/reply_test.go` (an approved article reaches the
brain and its price may be quoted).
