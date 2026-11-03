"""DEVELOPMENT ONLY: asks Claude through Claude Code's command line
(`claude -p`) on the Claude Code login of this computer, so the assistant can
be tried without an API key (the old adapters/claude-code.ts). Anthropic
doesn't allow a product to run on a claude.ai login: the brain refuses this
engine unless ANSA_ENV is "development".

Locked down: no tools at all (no files, no shell, no web, no MCP), no
settings, skills or CLAUDE.md files loaded, no session saved to disk, run in
an empty folder of its own, with only the few environment variables a login
needs (never ansa's secrets). The conversation goes in on stdin, never on the
command line. Nothing it prints is ever logged; failures are a name only."""

import json
import os
import subprocess
import tempfile
from collections.abc import Callable, Mapping
from typing import Any

from brain.ai import ModelResult

# One answer may take this long: a program starts first.
TIMEOUT_SECONDS = 90
# The most the answer may be: a short JSON reply and Claude Code's details.
MAX_OUTPUT_BYTES = 2 * 1024 * 1024
# Structured output takes two turns (the answer, then its check); a few more
# leave room, and anything beyond is cut off.
MAX_TURNS = "4"

# The only variables passed on: where programs are and whose login it is.
PASSED_ON = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR"]
# Switches that keep Claude Code from loading or sending anything else.
LOCKED_DOWN = {
    "CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "1",
}

# Runs the program: (arguments, stdin text, folder, environment) -> (exit code, stdout).
Runner = Callable[[list[str], str, str, dict[str, str]], tuple[int, bytes]]


def arguments(binary: str, system_prompt: str, json_schema: dict[str, Any], model: str, effort: str) -> list[str]:
    """The command line: one prompt, JSON out in the schema, nothing else loaded or allowed."""
    return [
        binary,
        "-p",
        "--output-format", "json",
        "--json-schema", json.dumps(json_schema),
        "--system-prompt", system_prompt,
        "--tools", "",
        "--strict-mcp-config",
        "--disallowedTools", "mcp__*",
        "--setting-sources", "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--max-turns", MAX_TURNS,
        "--model", model,
        "--effort", effort,
    ]  # fmt: skip


def environment(parent: Mapping[str, str]) -> dict[str, str]:
    """PASSED_ON from the brain's own environment, and the switches above. Nothing else."""
    result = dict(LOCKED_DOWN)
    for name in PASSED_ON:
        if parent.get(name):
            result[name] = parent[name]
    return result


def run_program(args: list[str], stdin_text: str, folder: str, env: dict[str, str], timeout: float = TIMEOUT_SECONDS) -> tuple[int, bytes]:
    """Runs Claude Code once; a run past its time is stopped and counts as a failure."""
    completed = subprocess.run(args, input=stdin_text.encode(), capture_output=True, cwd=folder, env=env, timeout=timeout, check=False)
    return completed.returncode, completed.stdout


def ask_claude_code(system_prompt: str, prompt: str, json_schema: dict[str, Any], effort: str, run: Runner = run_program, parent_env: Mapping[str, str] = os.environ) -> ModelResult:
    """Asks Claude Code once for a JSON answer following json_schema."""
    binary = parent_env.get("CLAUDE_CODE_PATH") or "claude"
    model = parent_env.get("ANTHROPIC_MODEL") or "claude-sonnet-5-5"
    with tempfile.TemporaryDirectory(prefix="ansa-claude-code-") as folder:
        try:
            code, output = run(arguments(binary, system_prompt, json_schema, model, effort), prompt, folder, environment(parent_env))
        except subprocess.TimeoutExpired:
            return ModelResult(kind="error", error_name="ClaudeCodeTimeout")
        except FileNotFoundError:
            return ModelResult(kind="error", error_name="ClaudeCodeNotFound")
        except OSError:
            return ModelResult(kind="error", error_name="ClaudeCodeError")
    if code != 0:
        return ModelResult(kind="error", error_name="ClaudeCodeFailed")
    if len(output) > MAX_OUTPUT_BYTES:
        return ModelResult(kind="error", error_name="ClaudeCodeOutputTooLarge")
    return read_result(output.decode("utf-8", errors="replace"))


def read_result(output: str) -> ModelResult:
    """What `claude -p --output-format json` printed: its structured_output, whole."""
    try:
        parsed = json.loads(output)
    except ValueError:
        return ModelResult(kind="error", error_name="ClaudeCodeUnreadable")
    if not isinstance(parsed, dict):
        return ModelResult(kind="error", error_name="ClaudeCodeUnreadable")
    if parsed.get("subtype") == "error_max_turns":
        return ModelResult(kind="truncated")
    if parsed.get("is_error") is True or parsed.get("subtype") != "success":
        return ModelResult(kind="error", error_name="ClaudeCodeError")
    answer = parsed.get("structured_output")
    if not isinstance(answer, dict):
        # Claude declined, or ended without the answer the schema asks for.
        return ModelResult(kind="unexpected_stop")
    return ModelResult(kind="ok", output_text=json.dumps(answer))
