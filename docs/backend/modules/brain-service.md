# brain service (brain/)

**What:** the Python web service that thinks.
**Rules:** listens on a private address only; `/health` is open, every other
route needs core's signature (fresh within 60 seconds) and a body up to
512 KB; no database, no files, no state between requests; API docs pages are
switched off.
**Routes today:** `GET /health`, `POST /v1/ping` (signed no-op).
**Tests:** `brain/tests/test_security.py`: the signature matches core's; only
signed, fresh requests pass; a body over the cap is refused.
