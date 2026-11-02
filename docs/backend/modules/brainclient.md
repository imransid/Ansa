# brainclient (core/internal/brainclient)

**What:** core's only way to call the brain.
**Rules:** every request is signed (HMAC-SHA256 over `<unix seconds>.<body>`
with BRAIN_SHARED_SECRET, in `X-Ansa-Timestamp` and `X-Ansa-Signature`); an
answer is read up to 1 MB; any failure is `ErrBrainUnavailable`, and the
caller takes its safe path (the assistant: the holding reply and an alert).
**Waits (`waits.go`):** how long core waits for each use's answer (a chat
reply and an email 120 s, "Post for me" 135 s, a call, a menu, a review and
a draft 260 s, the Co-Founder 285 s, the brain's status 5 s), each longer
than the brain may take for it.
**Tests:** `client_test.go`: the signature covers time and body; a signed call
reads the answer; a refused one is `ErrBrainUnavailable`. The brain's test
`brain/tests/test_security.py` checks the same input, so both sides agree.
`waits_test.go` reads `brain/brain/ai.py` (each use's time a try, its
retries, the longest wait between tries) and `claude_code.py`, and fails
when the brain could still be working after core stopped waiting (5 s
allowed for the brain's own work); a new use must be given its wait.
