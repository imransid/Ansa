# Outside packages, and why each is here

Every package outside the language's standard library is a door for an
attacker (the 2025 npm worms are the reminder). Add one only with a line here.

## core (Go)
| Module | Why |
|---|---|
| github.com/jackc/pgx/v5 | The PostgreSQL driver and pool (parameterized queries only) |
| golang.org/x/text | NFKC normalisation for safe email sender names; `encoding/htmlindex` decodes a web page in the charset its server names ("Import a web page") (Go's own extended packages; pgx needs it too) |
| golang.org/x/net | `idna`: an international email domain converted to ASCII as browsers do (Go's own extended packages) |
| golang.org/x/crypto, golang.org/x/sync | Pulled in by pgx (Go's own extended packages) |

## brain (Python), exact versions in `brain/requirements.txt`
| Package | Why |
|---|---|
| fastapi, starlette | The web service and its request checks |
| pydantic, pydantic_core | Strict models for every request and answer |
| uvicorn | Runs the service |
| pypdf 6.20.1 (2026-10-12, BSD-3, pure Python, no dependencies on Python 3.11+) | A PDF's text for "Add to knowledge" (`brain/brain/documents/pdf_text.py`); the old backend used PDF.js. Kept in the brain, apart from core: a hostile PDF can only slow the brain's worker thread |
| anthropic (and its helpers: anyio, httpx, httpcore, h11, certifi, idna, jiter, sniffio, docstring_parser, typing_extensions) | Anthropic's official SDK: the only way the brain asks the AI model |
| pytest, httpx (tests only) | Tests and the test client |
