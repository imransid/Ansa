import hashlib
import hmac
import json
import time

from fastapi.testclient import TestClient

from brain import ai, claude_code, free_ai
from brain.app import create_app
from brain.settings import Settings

UNAVAILABLE = ai.ModelResult(kind="unavailable")
SECRET = "s" * 40


def no_key(*_asked):
    return UNAVAILABLE


def a_program(folder):
    """A stand-in for the claude program, allowed to run: it leaves a mark if it ever is."""
    program = folder / "claude"
    program.write_text(f"#!/bin/sh\ntouch '{folder / 'ran'}'\n")
    program.chmod(0o755)
    return program


def status(development: bool = True) -> dict:
    """The brain's /v1/status, asked as core asks it (signed)."""
    client = TestClient(create_app(Settings(shared_secret=SECRET, development=development)))
    now = str(int(time.time()))
    signature = hmac.new(SECRET.encode(), now.encode() + b".{}", hashlib.sha256).hexdigest()
    return client.post("/v1/status", content=b"{}", headers={"X-Ansa-Timestamp": now, "X-Ansa-Signature": signature}).json()


def test_development_without_a_key_asks_claude_code_with_the_uses_own_time(monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(a_program(tmp_path)))
    seen = {}

    def fake_ask(system_prompt, prompt, schema, effort, run):
        seen.update(prompt=prompt, effort=effort, run=run)
        return ai.ModelResult(kind="ok", output_text=json.dumps({"summary": "x"}))

    monkeypatch.setattr(claude_code, "ask_claude_code", fake_ask)
    result = free_ai.or_claude_code(no_key, development=True)("system", "the prompt", {}, ai.MARKETING_PLAN, None)
    assert result.kind == "ok" and seen["prompt"] == "the prompt" and seen["effort"] == ai.MARKETING_PLAN.effort
    ran = {}
    monkeypatch.setattr(claude_code, "run_program", lambda args, stdin_text, folder, env, timeout: ran.update(timeout=timeout) or (0, b""))
    seen["run"]([], "", "", {})
    assert ran["timeout"] == max(claude_code.TIMEOUT_SECONDS, ai.MARKETING_PLAN.timeout_seconds)


def test_never_in_production_with_a_key_without_claude_code_or_for_a_photo(monkeypatch, tmp_path):
    def must_not_run(*_args, **_kwargs):
        raise AssertionError("Claude Code must not be asked")

    monkeypatch.setattr(claude_code, "ask_claude_code", must_not_run)
    assert free_ai.or_claude_code(no_key, development=True)("s", "p", {}, ai.EMAIL_TRIAGE, None).kind == "unavailable"
    # A program that isn't there answers nothing: the use stays "unavailable".
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(tmp_path / "gone"))
    assert free_ai.or_claude_code(no_key, development=True)("s", "p", {}, ai.EMAIL_TRIAGE, None).kind == "unavailable"
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(a_program(tmp_path)))
    assert free_ai.or_claude_code(no_key, development=False)("s", "p", {}, ai.EMAIL_TRIAGE, None).kind == "unavailable"
    photo = [{"type": "image", "source": {}}, {"type": "text", "text": "the menu"}]
    assert free_ai.or_claude_code(no_key, development=True)("s", photo, {}, ai.MENU_READING, None).kind == "unavailable"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-made-up")
    assert not free_ai.ready(True)
    answered = ai.ModelResult(kind="ok", output_text="{}")
    assert free_ai.or_claude_code(lambda *_asked: answered, development=True)("s", "p", {}, ai.EMAIL_TRIAGE, None) is answered


def test_claude_code_is_ready_only_when_its_program_is_there(monkeypatch, tmp_path):
    # The status looks for the program claude_code.py runs (the one
    # CLAUDE_CODE_PATH names, else claude on the PATH), and never runs it.
    program = a_program(tmp_path)
    monkeypatch.setenv("PATH", str(tmp_path / "nothing-here"))
    assert status()["claude_code"] is False
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(program))
    assert status()["claude_code"] is True
    program.chmod(0o644)
    assert status()["claude_code"] is False
    program.chmod(0o755)
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(tmp_path / "gone"))
    assert status()["claude_code"] is False
    monkeypatch.delenv("CLAUDE_CODE_PATH")
    monkeypatch.setenv("PATH", str(tmp_path))
    assert status()["claude_code"] is True
    assert status(development=False)["claude_code"] is False
    # It runs in an empty folder of its own, where a relative path finds nothing.
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CLAUDE_CODE_PATH", "./claude")
    assert status()["claude_code"] is False
    assert not (tmp_path / "ran").exists()


def test_the_free_stand_in_is_never_called_ansas_key(monkeypatch, tmp_path):
    # In development without a key, Claude Code on this computer answers in
    # place of ansa's key: the status says so apart (Settings → Assistant then
    # never says "ansa's key" on the laptop), and ansa_key keeps its meaning.
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(a_program(tmp_path)))
    assert status() == {"ansa_key": False, "claude_code": True, "free_stand_in": True}
    assert status(development=False) == {"ansa_key": False, "claude_code": False, "free_stand_in": False}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-made-up")
    assert status() == {"ansa_key": True, "claude_code": True, "free_stand_in": False}
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(tmp_path / "gone"))
    assert status() == {"ansa_key": False, "claude_code": False, "free_stand_in": False}
