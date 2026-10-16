# Going live

The checklist for the first production deploy. Hosting is assumed to be
Vercel (proposed, not decided yet); the few Vercel-specific parts are marked.

## 1. Database (Neon)

1. Create a Neon project in the region closest to where the app runs.
2. Copy two connection strings, both with `?sslmode=require`:
   - the **pooled** one (host contains `-pooler`): the app's `DATABASE_URL`
   - the **direct** one: only for running migrations
3. Create the tables from your machine:
   `DATABASE_URL="<direct url>" pnpm db:migrate`
   (a `DATABASE_URL` set on the command line wins over `.env.local`).
4. Run migrations the same way before every deploy that adds one.

Neon keeps point-in-time backups; check the retention on your plan.

## 2. Private file storage (Cloudflare R2)

1. Create a bucket. Leave public access OFF and add no custom domain.
2. Create an R2 API token limited to that bucket, with Object Read & Write.
3. Set `USE_R2_STORAGE=true`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## 3. Email (Resend)

1. Verify your sending domain in Resend. Set `EMAIL_FROM` (an address on it),
   `RESEND_API_KEY` and `SEND_REAL_EMAIL=true`.
2. Set up Resend Receiving for your support domain.
3. Add one webhook: `https://<your domain>/api/webhooks/resend`, with the events
   `email.received`, `email.bounced` and `email.complained`. Copy its signing
   secret into `RESEND_WEBHOOK_SECRET`.
4. Each company adds its support addresses on its Setup page.

## 4. Calls (Vapi)

1. Server URL: `https://<your domain>/api/webhooks/vapi`.
2. Generate a secret (`openssl rand -hex 32`), put it in a Vapi HMAC credential
   and in `VAPI_WEBHOOK_SECRET`.
3. Confirm Vapi's real signing format against the `VAPI_SIGNATURE_*` settings
   with the first real call (see the known gaps in CLAUDE.md).
4. Each company adds its Vapi phone number ids on its Setup page.

## 5. Claude

Set `ANTHROPIC_API_KEY`. `ANTHROPIC_MODEL` defaults to `claude-sonnet-5-5`.

## 6. Everything else

| Setting | Value |
| --- | --- |
| `BETTER_AUTH_URL` | `https://<your domain>` (links in emails use it) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (new, not the dev one) |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32` (new). **Save it in a password manager now**: losing it loses every transcript and email. |
| `CRON_SECRET` | `openssl rand -hex 32` |

Use new values for every secret. Never reuse the ones in your `.env.local`.

## 7. Hosting (Vercel, if chosen)

- Import the GitHub repo and add every setting above as an environment variable.
- `vercel.json` schedules the daily cleanup (`/api/cron/cleanup`, 04:00 UTC).
  Vercel sends `CRON_SECRET` with it by itself. Elsewhere, have any scheduler call
  it with `Authorization: Bearer <CRON_SECRET>`.
- Rate limits trust `x-forwarded-for`. Vercel overwrites that header, so it can't
  be faked there. On other hosting, check that the proxy does the same.
- Requests are capped at 4.5 MB, which is why documents are capped at 4 MB.

## 8. After the first deploy

1. Open the logs. Any line starting with `Production setting:` names a setting
   still missing; fix it and redeploy.
2. Sign up, confirm the email (a real email must arrive), and fill in the Setup page.
3. Send an email to a support address: a ticket should appear.
4. Make a test call: a call and, if escalated, a ticket should appear.
5. Solve a ticket with your own address as the customer email: the email arrives.

## Errors

Every failed request writes one JSON line to the logs with
`"event":"request_error"`: the error's class, Postgres code and constraint, the
route pattern and stack frames. Error messages are never logged, because they
can contain customer data (Rule 1). Choosing an error monitoring service is
still open; it would receive the same data-free report.

## Checks on every push

`.github/workflows/checks.yml` runs types, lint, every tenant isolation check
against a fresh database, and a production build on every push and pull
request. It uses made-up secrets and calls no real service.
