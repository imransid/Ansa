# ansa's new backend

This folder documents the new backend that replaces the TypeScript backend
inside the Next.js app. Start here, then read the other files in this order:

1. [architecture.md](architecture.md): the three parts and how a message travels through them.
2. [security.md](security.md): the rules that keep every company's data safe. Read before writing any code.
3. [conventions.md](conventions.md): how code is written here, so anyone can read and extend it.
4. [migration-plan.md](migration-plan.md): what moves from the old backend, in which order, and where we are.
5. [try-it.md](try-it.md): run the screens on the new backend on your laptop, and what to try.
5. [modules/](modules/): one page per module: what it does, its rules, its tests.

## In one picture

```
 Customers (Telegram, Messenger, WhatsApp, email, phone)
        │
        ▼
 ┌───────────────────┐   asks "what should we answer?"   ┌──────────────────┐
 │  core/  (Go)      │ ─────────────────────────────────► │  brain/ (Python) │
 │  "the body"       │ ◄───────────────────────────────── │  "the brain"     │
 │  receives, checks,│      a proposed answer             │  thinks, writes, │
 │  saves, sends,    │                                    │  remembers       │
 │  keeps companies  │                                    │  (no database    │
 │  apart            │                                    │   access)        │
 └─────────┬─────────┘                                    └──────────────────┘
           │ the only part that touches the database
           ▼
     PostgreSQL (the same database and tables as today)
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
- **Next.js** keeps only the screens.

## Folders

| Folder | Language | What it is |
|---|---|---|
| `core/` | Go | The backend service. `core/README.md` says how to run and test it. |
| `brain/` | Python | The AI service. `brain/README.md` says how to run and test it. |
| `docs/backend/` | Markdown | This documentation. |
| `db/migrations/` | SQL | The database's tables. Plain SQL, shared by the old and the new backend until the switch-over. |

## Status

See [migration-plan.md](migration-plan.md) for every module and its status.
