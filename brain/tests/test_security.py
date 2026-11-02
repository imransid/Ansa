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


def test_the_status_says_what_the_brain_can_answer_with_never_the_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret-value")
    client = TestClient(create_app(Settings(shared_secret=SECRET, development=True)))
    body = b"{}"
    answer = client.post("/v1/status", content=body, headers=sign(body, int(time.time())))
    assert answer.json() == {"ansa_key": True, "claude_code": True}
    assert "sk-ant" not in answer.text


def test_the_ai_door_never_logs_or_traces(monkeypatch):
    # Whatever ANTHROPIC_LOG or the tracing settings say: no SDK log line
    # (they can show a request) and no OpenTelemetry span.
    import logging

    from brain import ai

    assert not logging.getLogger("anthropic").isEnabledFor(logging.CRITICAL)
    assert not logging.getLogger("anthropic._base_client").isEnabledFor(logging.DEBUG)
    assert not logging.getLogger("httpx2").isEnabledFor(logging.CRITICAL)

    made = {}

    class StopHere(Exception):
        pass

    def fake_client(**options):
        made.update(options)
        raise StopHere

    monkeypatch.setattr(ai, "_Client", fake_client)
    try:
        ai.ask("system", "prompt", {"type": "object"}, ai.ASSISTANT_REPLY, api_key="sk-test")
    except StopHere:
        pass
    assert made.get("open_telemetry") == {"propagation": False, "traces": False}


def test_a_long_retry_after_never_holds_the_brain():
    # Anthropic's SDK waits as long as a 429's retry-after asks; the brain's
    # client waits at most 8 seconds, so every use ends before core stops
    # waiting for it (core/internal/brainclient/waits_test.go checks those).
    import httpx2
    from anthropic._models import FinalRequestOptions

    from brain import ai

    client = ai._Client(api_key="sk-test", timeout=1, max_retries=1, open_telemetry=ai.NO_TRACING)
    options = FinalRequestOptions.construct(method="post", url="/v1/messages")
    assert client._calculate_retry_timeout(1, options, httpx2.Headers({"retry-after": "600"})) == ai.MAX_RETRY_WAIT_SECONDS
    assert client._calculate_retry_timeout(1, options, httpx2.Headers({"retry-after": "3"})) == 3
    assert ai.CALL_DECISION.longest_seconds() == 60 * 3 + 8 * 2

