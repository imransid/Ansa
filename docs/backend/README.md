# ansa's backend

This folder documents ansa's backend: **core** (Go) and the **brain**
(Python). Since 2026-11-02 they are ansa's only backend: the TypeScript
backend that used to live inside the Next.js app is gone, and the screens
ask core for everything. Start here, then read the other files in this order:

1. [architecture.md](architecture.md): the three parts and how a message travels through them.
2. [security.md](security.md): the rules that keep every company's data safe. Read before writing any code.
3. [conventions.md](conventions.md): how code is written here, so anyone can read and extend it.
4. [migration-plan.md](migration-plan.md): how the old backend was moved, module by module, and what is left (deploying).
5. [try-it.md](try-it.md): run all three parts on your laptop, and what to try.
6. [modules/](modules/): one page per module: what it does, its rules, its tests.

## In one picture

```
 Customers (WhatsApp, Telegram, Messenger, email, phone calls)
        │
        ▼
 ┌───────────────────┐   asks "what should we answer?"   ┌──────────────────┐
 │  core/  (Go)      │ ─────────────────────────────────► │  brain/ (Python) │
 │  "the body"       │ ◄───────────────────────────────── │  "the brain"     │
 │  receives, checks,│      a proposed answer             │  thinks, writes, │
 │  saves, sends,    │                                    │  proposes        │
 │  keeps companies  │                                    │  (no database    │
 │  apart            │                                    │   access)        │
 └─────────┬─────────┘                                    └──────────────────┘
           │ the only part that touches the database
           ▼
     PostgreSQL (the tables of db/migrations/)
           ▲
           │ reads and changes data only through core's API
 ┌─────────┴─────────┐
 │  Next.js (app/)   │  the screens: website and dashboard
 └───────────────────┘
```

- **core/** is written in Go. It does all the work: webhooks, sending messages,
  orders, posting, logins, payments, background jobs and every security rule.
- **brain/** is written in Python. It only thinks: it gets one company's
  slice of data from core, asks the AI model, and returns a proposal. Core
  checks every proposal before anything reaches a customer.
- **Next.js** keeps only the screens. Every page and form asks core through
  one door, `lib/core-api.ts` (signed requests; see [api](modules/api.md)).

## Folders

| Folder | Language | What it is |
|---|---|---|
| `core/` | Go | The backend service. `core/README.md` says how to run and test it. |
| `brain/` | Python | The AI service. `brain/README.md` says how to run and test it. |
| `app/`, `components/`, `lib/` | TypeScript | The screens (Next.js). `lib/core-api.ts` is their one door to core; `lib/core-views/` holds one file of reads and writes per area. |
| `db/schema/`, `db/migrations/` | TypeScript, SQL | The database's tables: the Drizzle schema and the SQL migrations made from it (`pnpm db:generate`, `pnpm db:migrate`). Only core reads and writes the tables. |
| `docs/backend/` | Markdown | This documentation. |

## Status

Every module is in core or the brain, and the old backend is deleted. What
is left is putting the three parts on servers (hosting is still to be
chosen): see [migration-plan.md](migration-plan.md), Phase 8, and
`docs/going-live.md`.
