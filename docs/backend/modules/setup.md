# setup (core/internal/setup)

**What:** the setup a new owner fills in at /welcome, one step at a time,
and the same sections on Settings → What it knows (the old
`services/restaurant-setup.ts`, `db/restaurant-setup.ts`,
`db/setup-facts.ts`). Owners change it (`settings.AsOwner`: the company row
lock, then the person read again); everyone in the company reads it.
**Steps (`steps.go`):** a business: business, contact, hours, orders,
assistant, connect, ready; one person: business, away, assistant, connect,
ready. `setup_progress` records how many were saved and is only ever raised
(a section saved from Settings doesn't count as a step). Changing who ansa
is for starts the later steps again.
**Sections, each with the old form's words (`Check`) and one write:**
- business (`business.go`): who it is for, the name (2-100, no control
  characters; the "company_name" fact too), a business's kind (the list) and
  what it offers (one line up to 300; the "description" fact). Changing the
  kind switches when ansa answers (a person: only while away) and the
  holding reply while it is still one of ansa's own (never one the owner wrote).
- contact: the address (the "location" fact, one line up to 300) and the
  phone customers may call (digits, spaces and + ( ) - only, up to 40).
- hours / away: each day as the old form read it (`hours.ReadDay`), a time
  zone this server knows; away also the minutes ansa waits (5, 10, 15, 30, 60, or none).
- orders: takes orders, delivery and its note, the fee typed as a price in
  the currency ("2,5" = 2.50; empty = free), pickup, the payment note, an
  ISO 4217 currency (`golang.org/x/text/currency`).
- assistant: what ansa may say (0-2,000) and the holding reply (1-500).
- connect saves nothing; `Finish` ("Open ansa") only once every step was saved.
The name, description and address are the owner's confirmed business facts
(`facts.go`), so posts can use them; a waiting proposal that says the same is cleared.
**API:** `GET /api/v1/setup` (the profile, its steps, and the settings);
`POST /api/v1/setup/{section}?from=setup` (owners, 60 changes per 10
minutes) answers `{"nextStep"}` or `{"fields": {...}}`; `finish` before every
step = 409.
**Tests:** `api/setup_test.go` (live database): step 1's problems in the old
words; every step saved in order; an unknown currency refused; finish
refused until every step, then finished; the profile (address, fee in
cents, phone); the name is a confirmed fact; turning into a person keeps
the owner's own holding reply and answers only while away.
