# How code is written here

The goal: someone who has never seen ansa can open any file, understand it,
and change it safely.

## For everyone
- **Clear names over short names**: `listOpenOrders`, not `lso`.
- **Small functions, one job each.** A file past ~200 lines is split.
- **Comments say WHY, not what.** Every exported function has one line saying
  what it does.
- **No clever one-liners.** Obvious and repeated beats short and confusing.
- **Every module has a page** in `docs/backend/modules/`: what it does, its
  rules, its files, its tests. Change the page with the code.
- **Every rule has a test.** A bug fixed gets a test that fails without the fix.

## Go (core/)
- Layout:
  ```
  core/
    cmd/core/main.go           starts the service
    internal/<module>/         one folder per module
      <module>.go              the module's main functions
      <module>_test.go         its tests
  ```
- `internal/` only: nothing outside core imports it.
- Errors are returned, wrapped with `fmt.Errorf("what failed: %w", err)`;
  never `panic` in request handling.
- Database code lives in each module's `store.go` and takes a
  `tenant.CompanyID` first (see security.md, rule 1).
- Format with `gofmt`; check with `go vet` and `staticcheck` (`make check`
  runs the format check, `go vet` and every test; CI adds `staticcheck`).
- Tests use the standard `testing` package; database tests run against the
  local PostgreSQL and clean up their own company.

## Python (brain/)
- Layout:
  ```
  brain/
    brain/app.py               starts the service (FastAPI)
    brain/<area>/              one folder per area (assistant, posts, memory)
    tests/                     pytest tests, one file per area
  ```
- Type hints everywhere; Pydantic models for every request and answer.
- No database, no file writes, no global state between requests.
- Format with `ruff format`; check with `ruff check`.

## Commits
- Plain description of the change, nothing else. No tool attribution.
