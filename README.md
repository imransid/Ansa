# ansa

One app with two AI helpers for a business, sharing one knowledge base:

- **Support**: answers phone calls (Vapi) and emails (Resend), solves what it
  can, and makes a ticket for the right person when it can't.
- **Co-Founder**: learns the business in an interview, makes a marketing plan,
  writes posts for LinkedIn, Facebook, X and YouTube, publishes them once an
  owner approves, and reads back how they did.

The dashboard's "Business overview" shows both. See [CLAUDE.md](CLAUDE.md) for
the architecture, rules and build order, and
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for what is done, what is
blocked on outside accounts, and the evidence.

## Local setup

Needs Node 22 (the `engines` field in package.json), pnpm and Docker.

```bash
pnpm install
cp .env.example .env.local      # then fill in real values (see comments inside)
pnpm db:up                      # start Postgres in Docker on 127.0.0.1:5450
pnpm db:migrate                 # create the tables
pnpm dev                        # http://localhost:3000
```

If a page keeps reloading itself under `pnpm dev` (the terminal repeats
"Compiled in ..." and the same GET), the dev server's Turbopack cache is
stale: stop `pnpm dev`, delete `.next/dev` and start it again. Production
builds don't use that cache.

Going to production: see [docs/going-live.md](docs/going-live.md).

## Useful commands

| Command                       | What it does                                          |
| ----------------------------- | ----------------------------------------------------- |
| `pnpm db:generate --name x`   | Create a new migration after changing `db/schema/`    |
| `pnpm db:migrate`             | Apply pending migrations                              |
| `pnpm db:studio`              | Browse the database in the browser                    |
| `pnpm db:down`                | Stop the database (data is kept in a Docker volume)   |
| `pnpm check:tenant-isolation` | Every automated check: companies cannot see each other's data, every feature's rules, and one company's whole journey from signup to a checked performance review (local database only, with real email, R2 and Stripe off and no social platform app set) |
| `pnpm typecheck` / `pnpm lint`| Type check / lint (lint also blocks queries outside `/db`) |
| `pnpm build` / `pnpm start`   | Production build (every `/api` route must show ƒ) / run it on http://localhost:3000 as production runs: the stand-in social accounts, the stand-in image maker and Billing's simulate buttons are refused, but emails and files still use `.dev-emails/`, `.dev-inbound/` and `.dev-files/` unless `SEND_REAL_EMAIL` / `USE_R2_STORAGE` are `true` (a startup line warns about each) |
| `pnpm seed:tickets <your email>` | Add sample tickets to your company (local testing) |
| `pnpm try:brain <callId>`     | Run the call brain on one stored call and print only the verdict; saves nothing, but makes one real, paid Claude call |

The app answers `GET /api/health` with 200 while it can reach its database
(503 when it can't), for an uptime monitor. The scheduled jobs are two GET
routes that need `CRON_SECRET` (set it in `.env.local` to try them):
`curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/cleanup`
(the daily job) and `.../api/cron/publish` (sends due posts; call it every
minute in production).

By default development uses local stand-ins: while `ANTHROPIC_API_KEY`,
`SEND_REAL_EMAIL`, `USE_R2_STORAGE`, `USE_STRIPE` and the social platforms'
app settings (`LINKEDIN_CLIENT_ID` and the rest) are unset, emails are written
to `.dev-emails/`, received emails read from `.dev-inbound/`, files kept in
`.dev-files/`, posts written to `.dev-social/` by a "stand-in account"
(Co-Founder > Accounts), images made by a local stand-in, and post numbers
come only from `pnpm simulate:post-metrics`. Each of those settings switches
its service to the real one, in development too. With `ANTHROPIC_API_KEY`
set, what CLAUDE.md's known gaps list as sent to Anthropic (call transcript
slices, email text, interview answers, facts, articles, post data) leaves
your machine, so keep real customers' data out of a development database.
One thing always reaches the internet: Knowledge > "Import a web page"
fetches the address typed. Without `ANTHROPIC_API_KEY` the AI says it isn't
available and everything else still works.

Operator tools (ansa runs these; owners can't link phone numbers themselves):

| Command                                              | What it does                                              |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `pnpm link:phone-line <owner email> <vapi id> [--yes]` | Link a Vapi phone number to that owner's company        |
| `pnpm unlink:phone-line <owner email> <vapi id> [--yes]` | Undo a link (only while the number has no calls)      |
| `pnpm show:forwarding-address <owner email>`         | Print the company's forwarding address (also on Setup)    |
| `pnpm replace:forwarding-address <owner email> [--yes]` | Give the company a new forwarding address (old one stops) |
| `pnpm simulate:inbound-email <owner email> [variant]`| Send a fake signed customer email to the running app      |
| `pnpm simulate:vapi-call <vapi id> [variant]`        | Send a fake signed Vapi call report to the running app    |
| `pnpm simulate:vapi-tool-call <vapi id> "<question>" [--call <id>] [--end-call]` | Ask the running app's knowledge search as the voice assistant would during a call, and print its answer (`--end-call` then ends the call, so it shows on Calls) |
| `pnpm simulate:solved-call <vapi id>`                | Save a fake call the AI marked solved (local database only), to try "Escalate to a ticket" |
| `pnpm simulate:email-bounce <file in .dev-emails/> [kind]` | Tell the running app, as Resend would, that a sent email bounced (or `complained`, `suppressed`, `failed`) |
| `pnpm simulate:post-metrics <publish job id> views=120 reactions=8 ...` | Save simulated numbers for a post the development stand-in published (local database only), to try the Co-Founder's Analytics page and "Review performance"; the page shows each such post's id |

An `<owner email>` must be the address of an owner who confirmed it and was
not removed (any other account with it, such as one made by an invite another
company sent to that address, may belong to the wrong company). Link, unlink
and replace first print the company's name and change nothing: check it, then
run the same command again with `--yes`.
For a production company, run the link, unlink, show and replace commands from
your machine with `DATABASE_URL="<direct url>"` in front. The two
forwarding-address commands also need `INBOUND_EMAIL_DOMAIN=<production domain>`
in front: they refuse to run without it, because an address on the development
domain can't receive mail. See [docs/going-live.md](docs/going-live.md),
sections 3 and 4.
