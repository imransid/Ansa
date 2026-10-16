# ansa

AI first-line support for phone and email. See [CLAUDE.md](CLAUDE.md) for the
architecture, rules and build order.

## Local setup

Needs Node 22+, pnpm and Docker.

```bash
pnpm install
cp .env.example .env.local      # then fill in real values (see comments inside)
pnpm db:up                      # start Postgres in Docker on 127.0.0.1:5450
pnpm db:migrate                 # create the tables
pnpm dev                        # http://localhost:3000
```

Going to production: see [docs/going-live.md](docs/going-live.md).

## Useful commands

| Command                       | What it does                                          |
| ----------------------------- | ----------------------------------------------------- |
| `pnpm db:generate --name x`   | Create a new migration after changing `db/schema/`    |
| `pnpm db:migrate`             | Apply pending migrations                              |
| `pnpm db:studio`              | Browse the database in the browser                    |
| `pnpm db:down`                | Stop the database (data is kept in a Docker volume)   |
| `pnpm check:tenant-isolation` | Check that companies cannot see each other's data     |
| `pnpm typecheck` / `pnpm lint`| Type check / lint (lint also blocks queries outside `/db`) |
