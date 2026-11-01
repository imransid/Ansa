# Reads across companies

Every statement in core that reads more than one company's rows is listed
here with why, and carries the comment `-- cross-company: <reason>` so the
tenant check (tenant_test.go) lets it through. Each returns ids only, and the
work then continues through company-scoped functions with the row's own
company.

| Statement | File | Why |
|---|---|---|
| (none yet) | | |
