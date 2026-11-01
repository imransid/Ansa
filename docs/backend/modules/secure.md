# secure (core/internal/secure)

**What:** AES-256-GCM encryption of sensitive text stored in the database.
**Format:** `v1:<iv>:<tag>:<ciphertext>` (standard base64), a fresh 12-byte IV
each time, the full 16-byte tag, the context (company and record) as
additional data. Identical to the old `lib/encryption.ts`, so both backends
read the same rows.
**Rules:** anything unreadable is `ErrUnreadable` (a page shows "could not be
decrypted"); never log the value or the context; a short tag is refused.
**Tests:** `secure_test.go`: reads a value Node's crypto wrote the old way;
round trip with a fresh IV; another context or changed data fails; a short
tag or an unknown format fails; a wrong key is refused.
