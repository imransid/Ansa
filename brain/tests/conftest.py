import pytest


@pytest.fixture(autouse=True)
def no_real_ai(monkeypatch):
    """No test reaches a real model: no key of ansa's, and no Claude Code on
    this computer for the development stand-in (free_ai.py)."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_CODE_PATH", raising=False)
