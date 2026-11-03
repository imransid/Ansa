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


def must_not_run(*_args, **_kwargs):
    raise AssertionError("Claude Code must not be asked")


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


def test_never_in_production_with_a_key_without_claude_code_or_for_a_pdf(monkeypatch, tmp_path):
    monkeypatch.setattr(claude_code, "ask_claude_code", must_not_run)
    assert free_ai.or_claude_code(no_key, development=True)("s", "p", {}, ai.EMAIL_TRIAGE, None).kind == "unavailable"
    # A program that isn't there (and no claude on the PATH) answers nothing: the use stays "unavailable".
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(tmp_path / "gone"))
    assert free_ai.or_claude_code(no_key, development=True)("s", "p", {}, ai.EMAIL_TRIAGE, None).kind == "unavailable"
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(a_program(tmp_path)))
    assert free_ai.or_claude_code(no_key, development=False)("s", "p", {}, ai.EMAIL_TRIAGE, None).kind == "unavailable"
    # A PDF goes to Claude Code as its text (menu/reading.py), never as a document.
    pdf = [{"type": "document", "source": {}}, {"type": "text", "text": "the menu"}]
    assert free_ai.or_claude_code(no_key, development=True)("s", pdf, {}, ai.MENU_READING, None).kind == "unavailable"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-made-up")
    assert not free_ai.ready(True)
    answered = ai.ModelResult(kind="ok", output_text="{}")
    assert free_ai.or_claude_code(lambda *_asked: answered, development=True)("s", "p", {}, ai.EMAIL_TRIAGE, None) is answered


def test_a_photo_goes_to_claude_code_as_one_stream_json_message(monkeypatch, tmp_path):
    # Claude Code takes a photo on stdin only as a stream-json user message
    # (as the Agent SDK sends one), and then answers in stream-json, one
    # message a line, the result last (it needs --verbose for that).
    program = a_program(tmp_path)
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(program))
    seen = {}

    def fake_run(args, stdin_text, folder, env, timeout):
        seen.update(args=args, stdin=stdin_text, env=env)
        lines = [{"type": "system", "subtype": "init"}, {"type": "assistant", "message": {}}, {"type": "result", "subtype": "success", "is_error": False, "structured_output": {"items": []}}]
        return 0, "\n".join(json.dumps(line) for line in lines).encode()

    monkeypatch.setattr(claude_code, "run_program", fake_run)
    monkeypatch.setenv("BRAIN_SHARED_SECRET", "secret")
    photo = [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}}, {"type": "text", "text": "The menu is the photo above."}]
    result = free_ai.or_claude_code(no_key, development=True)("system", photo, {"type": "object"}, ai.MENU_READING, None)
    assert result.kind == "ok" and json.loads(result.output_text) == {"items": []}
    args = seen["args"]
    assert args[0] == str(program) and "--verbose" in args
    assert args[args.index("--input-format") + 1] == "stream-json" and args[args.index("--output-format") + 1] == "stream-json"
    assert args[args.index("--tools") + 1] == "" and "--no-session-persistence" in args and "iVBORw0KGgo=" not in " ".join(args)
    message = json.loads(seen["stdin"])
    assert message["type"] == "user" and message["message"] == {"role": "user", "content": photo}
    assert "secret" not in seen["env"].values()
    assert claude_code.read_result('{"type": "system"}\n{"type": "result", "subtype": "error_max_turns"}', streamed=True).kind == "truncated"
    assert claude_code.read_result('{"type": "system"}\nnot json', streamed=True).error_name == "ClaudeCodeUnreadable"


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
    # It runs in an empty folder of its own, where a relative path finds
    # nothing: such a path is never taken.
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CLAUDE_CODE_PATH", "./claude")
    monkeypatch.setenv("PATH", str(tmp_path / "nothing-here"))
    assert status()["claude_code"] is False
    assert not (tmp_path / "ran").exists()


def test_a_claude_code_path_that_is_gone_falls_back_to_claude_on_the_path(monkeypatch, tmp_path):
    # A path into an editor's extension folder disappears when the editor
    # updates itself: claude on the PATH answers instead, wherever it is asked.
    program = a_program(tmp_path)
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.setenv("CLAUDE_CODE_PATH", str(tmp_path / "extension-2.0.1" / "claude"))
    assert claude_code.program() == str(program)
    assert status() == {"ansa_key": False, "claude_code": True, "free_stand_in": True}
    seen = {}

    def fake_run(args, stdin_text, folder, env):
        seen.update(args=args)
        return 0, json.dumps({"subtype": "success", "structured_output": {"action": "no_reply"}}).encode()

    assert claude_code.ask_claude_code("system", "the conversation", {}, "low", run=fake_run).kind == "ok"
    assert seen["args"][0] == str(program)
    # A brain started by hand without CLAUDE_CODE_PATH: claude on the PATH
    # stands in for ansa's key too (the marketing and email uses).
    monkeypatch.delenv("CLAUDE_CODE_PATH")
    assert free_ai.ready(True) and status()["free_stand_in"] is True
    # Neither there: nothing is run.
    monkeypatch.setenv("PATH", str(tmp_path / "nothing-here"))
    assert claude_code.program() is None
    assert claude_code.ask_claude_code("system", "the conversation", {}, "low", run=must_not_run).error_name == "ClaudeCodeNotFound"
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
