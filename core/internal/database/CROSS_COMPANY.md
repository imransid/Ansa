# Reads across companies

Every statement in core that reads more than one company's rows is listed
here with why, and carries the comment `-- cross-company: <reason>` so the
tenant check (tenant_test.go) lets it through. Each returns ids only, and the
work then continues through company-scoped functions with the row's own
company.

| Statement | File | Why |
|---|---|---|
| Claim the next due job | internal/jobs/store.go | Workers serve every company: the claim returns the job's id, company and kind; the job then runs with its own company. |
| Hand back jobs cut off while running | internal/jobs/store.go | A worker that died leaves its job "running": after its lease, the job is queued again (or failed past its tries). Ids only. |
| Find a Telegram account by its business connection id | internal/telegram/store.go | The id Telegram sends names the company; returns that company and account id only. |
| Claim a conversation whose "answer if I haven't within N minutes" is due | internal/assistant/catchup.go | The catch-up serves every company: the claim clears the due time and returns the company and conversation ids; the reply job then runs with that company. |
| Claim a Telegram link code by its hash; find the code a Telegram user claimed | internal/telegram/linkstore.go | The code ansa made names its company (only its hash is stored); returns that code's id, company and maker only. |
| Update the Telegram account a business connection id names; find which company an account is tied to | internal/telegram/linkstore.go, linking.go | Telegram's connection id names the one company a code tied it to; only that row (its company id) is read or changed. |
| Find the one company that has a Facebook Page connected | internal/messenger/store.go | The Page id Meta signed names the company, only when exactly one has it; returns the company and connection ids only. |
| Find who a session cookie belongs to | internal/session/session.go | The session token names one person; returns their id, company, role, name and address, and only their own company is used after. |
| Find the company of a forwarding address's token | internal/resend/webhook.go | Only ansa makes forwarding addresses; the token names the company, only when exactly one matches; ids only. |
| Record a delivery problem on a sent email by Resend's id | internal/resend/webhook.go | Resend's id names one sent email of one company; only that row changes. |
