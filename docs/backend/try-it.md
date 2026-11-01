# Try the new backend on your laptop

The screens can run on the new backend (core + brain) or on the old one.
One switch decides: `CORE_API_URL` together with `SCREENS_SHARED_SECRET`.
Both backends use the same database, so your companies, logins, messages
and orders are the same on either side, and you can switch back at any time.

## 1. Start the brain (terminal 1)
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

## 2. Start core (terminal 2)
From the repository root: `cd core && make run`. It listens on
`127.0.0.1:8080` (CORE_LISTEN_ADDR in `.env.core`). Check:
`curl -i http://127.0.0.1:8080/health` answers 200.

Core does the background work too (the assistant's catch-up, posts, post
numbers, cleanup, emails, call analysis). Run only one core with its
scheduler on.

## 3. Start the screens on core (terminal 3)
Stop your usual `pnpm dev` first (two dev servers can't share the `.next`
folder). Then, from the repository root:

```
CORE_API_URL=http://127.0.0.1:8080 \
SCREENS_SHARED_SECRET="$(grep '^SCREENS_SHARED_SECRET=' .env.core | cut -d= -f2-)" \
pnpm dev
```

Open http://localhost:3000 and log in as usual. To go back to the old
backend, stop it and run plain `pnpm dev`.

## What to try together
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
- Calls: no Vapi account yet. Link a made-up number (`make link-phone-line
  OWNER=<your login email> NUMBER=pn-local-test YES=1`), set
  VAPI_WEBHOOK_SECRET in `.env.core` and restart core, then `make
  simulate-vapi-call NUMBER=pn-local-test` (a call a person must follow up)
  or `make simulate-solved-call OWNER=<your login email>
  NUMBER=pn-local-test` (one the AI marked solved, to try "Escalate").
- A customer email: with RESEND_WEBHOOK_SECRET in `.env.core` (any
  `whsec_` and base64 in development), `make simulate-inbound-email
  TO=<your login email>`. Every tool: [modules/commands.md](modules/commands.md).

## What still runs on the old backend
The hidden marketing pages (interview, strategy, studio, media, calendar,
queue, analytics) and LinkedIn, X and YouTube. Whether they move to core or
go away is the owner's decision (build step 57).
