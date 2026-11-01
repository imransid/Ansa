# documents and support setup (core/internal/documents, core/internal/supportsetup)

**What:** Settings → "Phone, email and documents" (the old /setup page:
`services/setup.ts`, `services/documents.ts`, `db/documents.ts`,
`db/company-settings.ts`, `lib/document-files.ts`). Owners change it;
everyone in the company reads it.

**Documents:** PDF, Word (.docx), text, Markdown and CSV files of up to 4 MB
(`Check`: by extension; the stored type comes from ansa's list, never from
the browser), at most 100 files and 200 MB per company (counted before each
upload: two at once can pass by a file, fine for a cost cap). Stored in
private storage ([files](files.md)) under
`documents/<companyId>/<documentId>.<ext>`, then the row (a row that can't
be saved removes its file). The name is shown as written, control
characters out, at most 200. Downloads are "save as", through a 5-minute
signed link (or the bytes in development); 200 per 10 minutes per person,
then 429 (never 404). Deleting removes the file FIRST, then the row (storage
refusing keeps the document listed to try again), clearing the source of
knowledge articles made from it in the row's transaction (the articles
stay). Uploads: 20 per 10 minutes per person. "Add to knowledge" moves with
the Knowledge page.

**Addresses (`supportsetup`):** the reply-to address of customer emails
("" clears it: replies go to the forwarding address) and the support
addresses customers write to (shown, and used to skip mail from the company
itself; they never decide where email goes; unique per company). Both use
the customer address rule ([addresses](requests.md)) and are never one of
ansa's own (EMAIL_FROM, or anything on the forwarding domain). The page also
reads the forwarding address, the last email and the phone lines
([channels](channels.md)) and what the checklist counts (active categories,
people, people without categories, documents).

**API ([api](api.md)):** `GET /api/v1/settings/support`; `POST
/api/v1/settings/support/reply-to` `{replyToEmail}`; `POST
/api/v1/settings/support/addresses` `{address}`; `POST
/api/v1/settings/support/addresses/remove` `{address}`; `POST
/api/v1/documents` `{fileName, data: base64}`; `GET
/api/v1/documents/{id}/download` → `{"url"}` or, in development,
`{"fileName", "contentType", "data"}`; `POST /api/v1/documents/{id}/delete`.

**Tests:** `documents_test.go` (types, sizes, names); `api/support_test.go`
(ansa's own addresses refused, an address listed once, a document uploaded,
listed with a plain name and its stored type, downloaded and deleted).
