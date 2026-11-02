# database (core/internal/database)

**What:** core's only door to PostgreSQL: the pool, transactions, health ping.
**Rules:**
- At most 10 connections per process; opening one gives up after 10 seconds.
  While all 10 are busy, a query waits for a free one as long as its caller's
  context allows (a request's, a job's lease).
- Every query takes a `tenant.CompanyID`
  first, and names `company_id` in every WHERE and INSERT.
- A read across companies carries `-- cross-company: <reason>` and is listed
  in `core/internal/database/CROSS_COMPANY.md` (ids only).
- An error's text is never logged or shown: it can hold the database address.
- `InTx` commits when the work returns nil, rolls back otherwise (and on a panic).
**Health:** `GET /health` is 200 when `SELECT 1` answers within 3 seconds, 503 otherwise.
**Tests:** `tenant_test.go` reads every Go file of core (tests aside:
`core/internal` and the commands in `core/cmd`) and fails on a statement
about a company's table without `company_id`; it also proves it catches one.
