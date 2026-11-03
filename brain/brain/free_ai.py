"""DEVELOPMENT ONLY: the free stand-in for ansa's own API key (the demo on
the laptop, docs/demo.md). Without ANTHROPIC_API_KEY every use that asks
with ansa's key gets "unavailable" (the marketing interview, plans, drafts,
reviews, email triage, call decisions, a menu's pasted text); on a
development brain with Claude Code set up (CLAUDE_CODE_PATH), it asks
Claude Code on this computer instead, locked down as always
(claude_code.py), so every feature can be tried and shown for free.

Never in production (Anthropic doesn't allow a product to run on a claude.ai
login), never when a key is set (that key is used), and never for a photo or
a PDF (Claude Code takes text only here: the menu's development sample
answers those)."""

import os
from collections.abc import Callable
from typing import Any

from brain import ai, claude_code

# (system prompt, prompt, JSON schema, use, the business's own key) -> result.
Asker = Callable[[str, Any, dict, ai.UseSettings, str | None], ai.ModelResult]


def ready(development: bool) -> bool:
    """Whether the stand-in answers here: development, no key, and Claude Code
    set up (the program CLAUDE_CODE_PATH names is there to run)."""
    return development and not os.environ.get("ANTHROPIC_API_KEY") and bool(os.environ.get("CLAUDE_CODE_PATH")) and claude_code.installed()


def or_claude_code(asker: Asker, development: bool) -> Asker:
    """The asker, and Claude Code when it answers "unavailable" (no key) on a
    development brain, with the use's own time (a marketing plan takes minutes)."""

    def ask(system_prompt: str, prompt: Any, schema: dict, use: ai.UseSettings, api_key: str | None) -> ai.ModelResult:
        result = asker(system_prompt, prompt, schema, use, api_key)
        if result.kind != "unavailable" or not ready(development) or not isinstance(prompt, str):
            return result
        timeout = max(claude_code.TIMEOUT_SECONDS, use.timeout_seconds)

        def run(args: list[str], stdin_text: str, folder: str, env: dict[str, str]) -> tuple[int, bytes]:
            return claude_code.run_program(args, stdin_text, folder, env, timeout)

        return claude_code.ask_claude_code(system_prompt, prompt, schema, use.effort, run=run)

    return ask
