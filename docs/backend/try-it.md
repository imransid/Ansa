# Run ansa on your laptop

ansa runs as three parts: the brain (Python), core (Go) and the screens
(Next.js). Start them in this order, each in its own terminal. The screens
ask core for everything; there is no other backend any more.

## Once: settings
- `.env.core` in the repository root (copy `core/.env.core.example`): core's
  settings. The brain reads its shared secret from there too.
- `.env.local` in the repository root (copy `.env.example`): the screens'
  three settings, `CORE_API_URL`, `SCREENS_SHARED_SECRET` (the SAME value as
  in `.env.core`) and `APP_URL`, plus the local database's for
  `pnpm db:up` and `pnpm db:migrate`.
- The brain's Python packages: `cd brain && python3 -m venv .venv &&
  .venv/bin/pip install -r requirements-dev.txt`.

## 1. Start the database
Docker must be running (on a Mac: open Docker Desktop first). From the
repository root: `pnpm db:up`, then `pnpm db:migrate` (only needed after a
new migration; it changes nothing otherwise).

## 2. Start the brain (terminal 1)
From the repository root:

```
cd brain
set -a && . ../.env.core && set +a
ANSA_ENV=development .venv/bin/uvicorn brain.app:create_app --factory --host 127.0.0.1 --port 8090
```

- With `ANTHROPIC_API_KEY` set in that terminal, the brain uses ansa's key.
- Without it, a business that chose "Claude Code on this computer"
  (Settings → Assistant) still gets answers (development only).
- Check: `curl -i http://127.0.0.1:8090/health` answers 200.

## 3. Start core (terminal 2)
From the repository root: `cd core && make run`. It listens on
`127.0.0.1:8080` (CORE_LISTEN_ADDR in `.env.core`). Check:
`curl -i http://127.0.0.1:8080/health` answers 200.

Core does the background work too (the assistant's catch-up, posts, post
numbers, cleanup, emails, call analysis). Run only one core with its
scheduler on.

## 4. Start the screens (terminal 3)
From the repository root: `pnpm dev`, then open http://localhost:3000 and
log in.

If a page keeps reloading itself (the terminal repeats "Compiled in ..."),
stop `pnpm dev`, delete `.next/dev` and start it again. After packages
change (`pnpm install`), restart `pnpm dev` too.

## What to try
- Home: the status card and its button, "Needs you", "What ansa did", the
  numbers.
- A customer message without Telegram: in a 4th terminal,
  `cd core && make simulate-message OWNER=<your login email> NAME="Lena" TEXT="Are you open tonight?"`.
  The answer appears in `.dev-messages/` and in the Inbox. With a stand-in
  Telegram account or Facebook Page connected (Connections), `make
  simulate-telegram` and `make simulate-messenger` take the same arguments.
- An order through the stand-in chat (ask for two dishes from your menu,
  answer "yes"), then Orders: Accept, Ready, Done.
- Settings → Assistant (Try your assistant), What it knows, Menu (Read my
  menu), Connections (a stand-in Telegram account), Posts for me (Post one
  now: the post is a file in `.dev-social/facebook/`).
- Inbox → a request: assign, note, solve (the email is a file in
  `.dev-emails/`), All requests, Emails.
- Team (invite link, roles, categories), Saved answers (knowledge), Phone,
  email and documents, Account (name, password), Billing (simulate).
- Log out and log in again; "Forgot password" (the link is in `.dev-emails/`).
- **A phone call, answered live (free, on this computer):** Settings →
  Connections → "practice phone". Pretend to be a caller, press Talk, speak,
  press "Stop and send", and hear ansa answer with your Mac's voice; or type
  what the caller says. Hang up, then open the call in the Inbox. Hearing
  your voice needs whisper.cpp once: `brew install whisper-cpp` (if
  Homebrew stops at an "untrusted tap" that isn't whisper's:
  `HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 brew install whisper-cpp`), a
  model (`ggml-small.bin` from https://huggingface.co/ggerganov/whisper.cpp,
  in `~/.cache/ansa-whisper/`), `WHISPER_MODEL_PATH` in `.env.core`, then
  restart the brain. Typing works without it. Each spoken turn takes about
  8-10 seconds to hear on an M2 (the model loads every time), plus ansa's
  thinking.
- Finished calls the old way (Vapi's report after the call): link a made-up number (`make link-phone-line
  OWNER=<your login email> NUMBER=pn-local-test YES=1`), set
  VAPI_WEBHOOK_SECRET in `.env.core` and restart core, then `make
  simulate-vapi-call NUMBER=pn-local-test` (a call a person must follow up)
  or `make simulate-solved-call OWNER=<your login email>
  NUMBER=pn-local-test` (one the AI marked solved, to try "Escalate").
- A customer email: with RESEND_WEBHOOK_SECRET in `.env.core` (any
  `whsec_` and base64 in development), `make simulate-inbound-email
  TO=<your login email>`. Every tool: [modules/commands.md](modules/commands.md).

## The marketing pages
Settings → "Social media posts" and the older pages (Overview, Interview,
Profile, Strategy, Calendar, Content studio, Media, Queue, Accounts,
Analytics) run on core too, LinkedIn, X and YouTube included (stand-in
accounts in development: their posts are files in `.dev-social/`). Fake post
numbers for a stand-in's published post: `make simulate-post-metrics
JOB=<publish job id> NUMBERS="views=120 reactions=8"`.
