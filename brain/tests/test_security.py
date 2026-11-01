import hashlib
import hmac
import time

from fastapi.testclient import TestClient

from brain.app import create_app
from brain.security import is_signed_by_core
from brain.settings import Settings

SECRET = "s" * 40


def sign(body: bytes, at: int, secret: str = SECRET) -> dict[str, str]:
    signature = hmac.new(secret.encode(), str(at).encode() + b"." + body, hashlib.sha256).hexdigest()
    return {"X-Ansa-Timestamp": str(at), "X-Ansa-Signature": signature, "Content-Type": "application/json"}


def test_signature_matches_cores_signing():
    # The same input as core/internal/brainclient/client_test.go.
    body = b'{"a":1}'
    expected = hmac.new(b"secret", b'1800000000.{"a":1}', hashlib.sha256).hexdigest()
    assert is_signed_by_core("secret", "1800000000", expected, body, now=1_800_000_000)
    assert not is_signed_by_core("secret", "1800000000", expected, b'{"a":2}', now=1_800_000_000)
    assert not is_signed_by_core("secret", "1800000000", expected, body, now=1_800_000_000 + 61)


def test_only_signed_requests_reach_the_brain():
    client = TestClient(create_app(Settings(shared_secret=SECRET)))
    body = b"{}"
    now = int(time.time())
    assert client.get("/health").status_code == 200
    assert client.post("/v1/ping", content=body).status_code == 401
    assert client.post("/v1/ping", content=body, headers=sign(body, now, "x" * 40)).status_code == 401
    assert client.post("/v1/ping", content=body, headers=sign(body, now - 120)).status_code == 401
    answer = client.post("/v1/ping", content=body, headers=sign(body, now))
    assert answer.status_code == 200 and answer.json() == {"status": "ok"}


def test_a_body_over_the_cap_is_refused():
    client = TestClient(create_app(Settings(shared_secret=SECRET)))
    body = b"x" * (512 * 1024 + 1)
    assert client.post("/v1/ping", content=body, headers=sign(body, int(time.time()))).status_code == 413
