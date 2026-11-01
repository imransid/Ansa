# email (core/internal/email, core/internal/plaintext)

**What:** core's ONE door for sending an email (the old `lib/send-email.ts`).
**How:**
- `Sender.Send(Message)`: through Resend's API when `SEND_REAL_EMAIL` is
  exactly "true" (`resend.go`: `POST /emails`, 20 s, the `Idempotency-Key`
  header so the same key never delivers twice), otherwise an HTML page in
  `<ANSA_DEV_FOLDER>/.dev-emails/` that nobody receives (`outbox.go`, the same
  page as the old dev outbox: open it in a browser).
- A failure is a short code only: Resend's own (`validation_error`),
  `timeout`, `no_answer`, a file system's (`EROFS`). A provider's message is
  free text that can name addresses: never kept or logged.
- `FromHeader(company)`: `"<Company> via ansa" <EMAIL_FROM>`. The name is
  NFKC-normalised (look-alikes like ＠ count), made one plain line, and loses
  `@ " < > \` and the encoded-word marks `=?` `?=`, so it can never pose as
  an address; at most 60 characters. `AccountFromHeader()`: `"ansa" <EMAIL_FROM>`.
- `plaintext.SingleLine` (the old `toPlainSingleLine`): line breaks and
  control characters become spaces, invisible format characters (a
  right-to-left override, a zero-width space) go, runs of spaces become one.
**Dependency:** `golang.org/x/text` (NFKC; Go's own extended packages, already
pulled in by pgx).
**Tests:** `email_test.go`: the sender name can never pose as an address; the
dev outbox writes one escaped file and sends nothing; Resend gets the key and
the idempotency key, and only its error code is kept. `plaintext_test.go`.
