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
