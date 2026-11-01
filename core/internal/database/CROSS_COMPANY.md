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
