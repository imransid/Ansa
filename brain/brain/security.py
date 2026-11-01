"""Checks that a request really came from core (docs/backend/security.md, rule 6).

Core signs every request: HMAC-SHA256 over "<unix seconds>.<body>" with
BRAIN_SHARED_SECRET, sent in X-Ansa-Timestamp and X-Ansa-Signature
(core/internal/brainclient/signing.go). A request that is unsigned, badly
signed, or older than MAX_AGE_SECONDS is refused before its body is read as
JSON.
"""

import hashlib
import hmac
import time

TIMESTAMP_HEADER = "x-ansa-timestamp"
SIGNATURE_HEADER = "x-ansa-signature"

# A signed request is accepted for this long (a little clock difference is fine).
MAX_AGE_SECONDS = 60


def is_signed_by_core(secret: str, timestamp: str | None, signature: str | None, body: bytes, now: float | None = None) -> bool:
    """True only for a fresh request signed with the shared secret."""
    if not secret or not timestamp or not signature or not timestamp.isdigit():
        return False
    current = time.time() if now is None else now
    if abs(current - int(timestamp)) > MAX_AGE_SECONDS:
        return False
    expected = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
