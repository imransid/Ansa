# brainclient (core/internal/brainclient)

**What:** core's only way to call the brain.
**Rules:** every request is signed (HMAC-SHA256 over `<unix seconds>.<body>`
with BRAIN_SHARED_SECRET, in `X-Ansa-Timestamp` and `X-Ansa-Signature`); an
answer is read up to 1 MB; any failure is `ErrBrainUnavailable`, and the
caller takes its safe path (the assistant: the holding reply and an alert).
**Tests:** `client_test.go`: the signature covers time and body; a signed call
reads the answer; a refused one is `ErrBrainUnavailable`. The brain's test
`brain/tests/test_security.py` checks the same input, so both sides agree.
