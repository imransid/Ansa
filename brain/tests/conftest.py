import pytest


@pytest.fixture(autouse=True)
def no_real_ai(monkeypatch, tmp_path_factory):
    """No test reaches a real model: no key of ansa's, and no Claude Code on
    this computer for the development stand-in (free_ai.py): neither the
    program CLAUDE_CODE_PATH names nor claude on the PATH (an empty folder)."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_CODE_PATH", raising=False)
    monkeypatch.setenv("PATH", str(tmp_path_factory.mktemp("no-programs")))
