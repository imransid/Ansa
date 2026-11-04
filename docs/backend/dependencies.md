# Outside packages, and why each is here

Every package outside the language's standard library is a door for an
attacker (the 2025 npm worms are the reminder). Add one only with a line here.

## core (Go)
| Module | Why |
|---|---|
| github.com/jackc/pgx/v5 | The PostgreSQL driver and pool (parameterized queries only) |
| golang.org/x/text | NFKC normalisation for safe email sender names and for the numbers a performance review writes; `encoding/htmlindex` decodes a web page in the charset its server names ("Import a web page"); `cases` lower-cases a knowledge search as Postgres's ICU lower-cases the index (full case mapping: "İ", a final "Σ") (Go's own extended packages; pgx needs it too) |
| golang.org/x/net | `idna`: an international email domain converted to ASCII as browsers do (Go's own extended packages) |
| golang.org/x/crypto | `scrypt`: passwords in Better Auth's own format, so existing passwords keep working (Go's own extended packages; pgx pulls it in too) |
| golang.org/x/sync | Pulled in by pgx (Go's own extended packages) |
| rsc.io/qr v0.2.0 | Draws the ansa phone app's pairing QR code as modules (`core/internal/devices/codes.go`): small, no dependencies of its own, by a Go author; the screens draw the rows core sends |

## brain (Python), exact versions in `brain/requirements.txt`
| Package | Why |
|---|---|
| fastapi, starlette (and annotated-doc, typing-inspection, annotated-types) | The web service and its request checks |
| pydantic, pydantic_core | Strict models for every request and answer |
| uvicorn (and click, h11) | Runs the service |
| pypdf 6.20.1 (2026-10-12, BSD-3, pure Python, no dependencies on Python 3.11+) | A PDF's text for "Add to knowledge" (`brain/brain/documents/pdf_text.py`); the old backend used PDF.js. Kept in the brain, apart from core: a hostile PDF can only slow the brain's worker thread |
| anthropic (and its helpers: httpx2, httpcore2, truststore, opentelemetry-api, anyio, certifi, idna, jiter, sniffio, docstring_parser, typing_extensions) | Anthropic's official SDK: the only way the brain asks the AI model. opentelemetry-api is only its tracing interface: the brain switches tracing off (`brain/brain/ai.py`) |
| pytest (and iniconfig, packaging, pluggy, pygments), httpx, httpcore (tests only) | Tests and the test client (starlette's speaks httpx) |

## screens (Next.js), exact versions in `package.json` and `pnpm-lock.yaml`
The screens keep only what pages and forms need: Next.js and React,
Tailwind, Base UI and lucide's icons (shadcn/ui's parts), Zod for forms,
and drizzle-orm for the schema's types (`lib/types/` describes core's
answers with them; lint lets nothing else of it in). Phase 8 removed every package only the
old backend used: the Anthropic SDK, the AWS SDK (R2), Better Auth, mammoth,
unpdf, Resend, standardwebhooks and Stripe. `pg` stays as a development
tool only (drizzle-kit's migrations); lint refuses it in the screens' code.
