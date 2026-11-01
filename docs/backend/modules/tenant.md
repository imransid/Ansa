# tenant (core/internal/tenant)

**What:** the `CompanyID` type every database function takes first.
**Rules:** made only by `FromTrustedSource`, from an id the server found
itself (a session, a connection row); never from a request body, query or
client header. Lowercase uuid only. Every call of `FromTrustedSource` is a
place to review.
**Tests:** `tenant_test.go`: uuids only, lowercased; an unset id says so.
