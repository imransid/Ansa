# ansa

ansa answers for you when you can't, on every channel you give it.

- **For a business** it answers the customers: questions, orders, problems
  it knows the solution to. What it can't answer becomes a request for the
  right person on the team. It can also post on the business's social media.
- **For one person** it answers while they are away, as "<name>'s AI
  assistant", takes a note of the rest, and tells them what they missed when
  they're back. It never pretends to be the person.

See [CLAUDE.md](CLAUDE.md) for the rules, the build order and the decisions,
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the earlier steps'
evidence, and [docs/backend/README.md](docs/backend/README.md) for how the
backend works.

## Three parts

| Part | Folder | Language | What it does |
|---|---|---|---|
| screens | `app/`, `components/`, `lib/` | TypeScript (Next.js) | The website and the dashboard. Never touch the database: they ask core for everything (`lib/core-api.ts`). |
| core | `core/` | Go | All the work and every security rule: webhooks, messages, orders, posting, logins, payments, scheduled work. The only part that touches the database. |
| brain | `brain/` | Python | The AI thinking only: core sends it one company's slice of data and checks what it proposes. |

The database's tables are described in `db/schema/` (Drizzle) and created by
the SQL migrations in `db/migrations/`.

## Local setup

Needs Node 22 and pnpm, Go 1.24, Python 3.14 and Docker.

```bash
pnpm install
cp .env.example .env.local            # the screens' settings (see the comments inside)
cp core/.env.core.example .env.core   # core's settings (see the comments inside)
pnpm db:up                            # start Postgres in Docker on 127.0.0.1:5450
pnpm db:migrate                       # create the tables
cd brain && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && cd ..
```

Then start the brain, core and the screens, each in its own terminal, and
open http://localhost:3000. The exact commands, and what to try:
[docs/backend/try-it.md](docs/backend/try-it.md). Or all at once, with two
ready demo accounts and a day of history: `pnpm demo` ([docs/demo.md](docs/demo.md):
a demo of every feature on this laptop, free).

Going to production: see [docs/going-live.md](docs/going-live.md).

## Useful commands

The screens (from the repository root):

| Command                       | What it does                                          |
| ----------------------------- | ----------------------------------------------------- |
| `pnpm dev`                    | The screens on http://localhost:3000 (core must be running) |
| `pnpm build` / `pnpm start`   | Production build / run it                             |
| `pnpm typecheck` / `pnpm lint`| Type check / lint (lint also refuses any database code in the screens) |
| `pnpm check:screens`          | The screens' own checks, read from their source (headings, navigation, forms, the marketing pages, the content rules the browser counts with) |
| `pnpm db:generate --name x`   | Create a new migration after changing `db/schema/`    |
| `pnpm db:migrate`             | Apply pending migrations                              |
| `pnpm db:studio`              | Browse the database in the browser                    |
| `pnpm db:down`                | Stop the database (data is kept in a Docker volume)   |
| `pnpm demo`                   | Everything at once for a demo on this laptop (database, brain, core, screens; the demo accounts the first time); Ctrl+C stops it all ([docs/demo.md](docs/demo.md)) |
| `pnpm demo:reset`             | Delete every `@demo.ansa.test` account (with its files and the rate limit counters) and make the demo again: three accounts and a day of history (development only) |

Core (from `core/`): `make run` starts it, `make check` runs formatting,
`go vet` and every test (on a test database of its own, `ansa_test`). ansa's
operator commands (linking a phone line, the forwarding address, Telegram's
webhook) and the development tools (a stand-in customer's message, made-up
calls and emails, sample requests, simulated post numbers) are `make`
targets too: [core/README.md](core/README.md).

The brain (from `brain/`): `.venv/bin/python -m pytest -q` runs its tests.

Core and the brain each answer `GET /health` (core: 200 while it can reach
the database). Core runs its scheduled work itself (the assistant's
catch-up, posts, post numbers, cleanup): nothing has to call a cron address.

## Development stand-ins

By default development uses local stand-ins: while the real services'
settings in `.env.core` are unset (`SEND_REAL_EMAIL`, `USE_R2_STORAGE`,
`USE_STRIPE`, the Telegram, Meta, LinkedIn, X and Google app settings),
emails are written to `.dev-emails/`, chat replies to `.dev-messages/`,
files kept in `.dev-files/`, posts written to `.dev-social/` by a "stand-in
account", images made by a local stand-in, and post numbers come only from
`make simulate-post-metrics`. Each of those settings switches its service to
the real one, in development too. With `ANTHROPIC_API_KEY` set for the
brain, what CLAUDE.md's known gaps list as sent to Anthropic (call
transcript slices, email text, chat messages, interview answers, facts,
articles, post data) leaves your machine, so keep real customers' data out
of a development database. One thing always reaches the internet:
Knowledge > "Import a web page" fetches the address typed. Without an AI
engine the assistant answers with the holding reply and makes a request for
a person; everything else still works.
