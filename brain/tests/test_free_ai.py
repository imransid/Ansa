import json

from brain import ai, claude_code, free_ai

UNAVAILABLE = ai.ModelResult(kind="unavailable")


def no_key(*_asked):
    return UNAVAILABLE


def test_development_without_a_key_asks_claude_code_with_the_uses_own_time(monkeypatch):
    monkeypatch.setenv("CLAUDE_CODE_PATH", "/made/up/claude")
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


def test_never_in_production_with_a_key_without_claude_code_or_for_a_photo(monkeypatch):
    def must_not_run(*_args, **_kwargs):
        raise AssertionError("Claude Code must not be asked")

    monkeypatch.setattr(claude_code, "ask_claude_code", must_not_run)
    assert free_ai.or_claude_code(no_key, development=True)("s", "p", {}, ai.EMAIL_TRIAGE, None).kind == "unavailable"
    monkeypatch.setenv("CLAUDE_CODE_PATH", "/made/up/claude")
    assert free_ai.or_claude_code(no_key, development=False)("s", "p", {}, ai.EMAIL_TRIAGE, None).kind == "unavailable"
    photo = [{"type": "image", "source": {}}, {"type": "text", "text": "the menu"}]
    assert free_ai.or_claude_code(no_key, development=True)("s", photo, {}, ai.MENU_READING, None).kind == "unavailable"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-made-up")
    assert not free_ai.ready(True)
    answered = ai.ModelResult(kind="ok", output_text="{}")
    assert free_ai.or_claude_code(lambda *_asked: answered, development=True)("s", "p", {}, ai.EMAIL_TRIAGE, None) is answered
