# brain service (brain/)

**What:** the Python web service that thinks.
**Rules:** listens on a private address only; `/health` is open, every other
route needs core's signature (fresh within 60 seconds) and a body up to
512 KB; no database, no files, no state between requests; API docs pages are
switched off.
**Routes today:** `GET /health`, `POST /v1/ping` (signed no-op).
**Tests:** `brain/tests/test_security.py`: the signature matches core's; only
signed, fresh requests pass; a body over the cap is refused.
**`POST /v1/status` (signed):** what the brain can answer with,
`{"ansa_key": bool, "claude_code": bool}`: whether ansa's own key is set and
whether Claude Code is allowed (development). Never the key. Core shows it
as "the AI is ready" on Home.
**`POST /v1/posts/write` (signed):** one "Post for me" post about what
core's topic brain chose, from the business's own details: `{"kind": "ok",
"body", "call_to_action", "hashtags"}` or `{"kind": "failed", "reason":
"model_unavailable" | "model_failed" | "unusable_answer"}`. Core checks the
text before it can go out. See [autopost](autopost.md).
**`POST /v1/documents/pdf-text` (signed, up to 6 MB):** a PDF's text
(`{"kind": "ok", "text"}` or `{"kind": "failed", "reason": "unreadable" |
"no_text"}`), at most 1,000 pages and 400,000 characters; pypdf's own
warnings are switched off (they can name what is inside the file). Core
cleans and cuts the text ([knowledge](knowledge.md)).
**`POST /v1/calls/decide` (signed, up to 6 MB):** a finished call's
decision (see [calls](calls.md)): `{outcome, source, reason_code,
customer_issue, explanation, ticket_subject, category, resolution_evidence,
error_name?}`. Rules first (no transcript, no customer speech, an abnormal
end), then the model, then the guards: anything missing, malformed or
unproven is "needs_human"; "solved" only with one whole confirming sentence
of the customer's last two turns.
