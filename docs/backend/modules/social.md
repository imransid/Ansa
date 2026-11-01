# social (core/internal/social)

**What:** the ONLY code in core that decrypts a social account's token (the
old `services/social-tokens.ts`). A token is read right before a call to its
platform and goes only to that platform's adapter. Stored encrypted with the
context `social-<kind>-token:<company>:<connection>`, as the old backend
wrote them; decrypted under the id Postgres gives back.
**Today:** `PageToken` (a connected Facebook Page's token, for Messenger).
A token that can't be read (a wrong DATA_ENCRYPTION_KEY) is `ErrNotUsable`
and marks nothing: the key is the fix, not a reconnect. Facebook Page
tokens don't run out; renewing X's and Google's tokens (one run at a time,
claimed in the database) moves with publishing (phase 4).
**Tests:** through `messenger_test.go` (the name job reads a Page token).
