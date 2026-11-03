"""DEVELOPMENT ONLY: asks Claude through Claude Code's command line
(`claude -p`) on the Claude Code login of this computer, so the assistant can
be tried without an API key (the old adapters/claude-code.ts). Anthropic
doesn't allow a product to run on a claude.ai login: the brain refuses this
engine unless ANSA_ENV is "development".

Locked down: no tools at all (no files, no shell, no web, no MCP), no
settings, skills or CLAUDE.md files loaded, no session saved to disk, run in
an empty folder of its own, with only the few environment variables a login
needs (never ansa's secrets). The conversation goes in on stdin, never on the
command line: as text, or a photo and its text as one stream-json message.
Nothing it prints is ever logged; failures are a name only."""

import json
import os
import shutil
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
# The content blocks it is given: text, and photos (a menu's). A PDF goes as
# its own text (menu/reading.py), never as a document.
CONTENT_TYPES = ("text", "image")

# Runs the program: (arguments, stdin text, folder, environment) -> (exit code, stdout).
Runner = Callable[[list[str], str, str, dict[str, str]], tuple[int, bytes]]


def arguments(binary: str, system_prompt: str, json_schema: dict[str, Any], model: str, effort: str, streamed: bool = False) -> list[str]:
    """The command line: one prompt, JSON out in the schema, nothing else loaded or allowed.
    Streamed (a photo): the prompt goes in as stream-json, which Claude Code
    answers only in stream-json, and only with --verbose."""
    formats = ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] if streamed else ["--output-format", "json"]
    return [
        binary,
        "-p",
        *formats,
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


def stdin_text(prompt: str | list[dict[str, Any]]) -> str:
    """What goes in on stdin: the text, or content blocks as one stream-json
    user message (as the Agent SDK sends one)."""
    if isinstance(prompt, str):
        return prompt
    message = {"type": "user", "message": {"role": "user", "content": prompt}, "parent_tool_use_id": None, "session_id": ""}
    return json.dumps(message) + "\n"


def takes(prompt: Any) -> bool:
    """Whether Claude Code can be asked this prompt: text, or content blocks of text and photos."""
    if isinstance(prompt, str):
        return True
    return isinstance(prompt, list) and bool(prompt) and all(isinstance(block, dict) and block.get("type") in CONTENT_TYPES for block in prompt)


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


def program(parent_env: Mapping[str, str] = os.environ) -> str | None:
    """The program it runs, only looked for (never run): the one
    CLAUDE_CODE_PATH names while that is an executable file, else claude on
    the PATH (a path into an editor's extension folder disappears when the
    editor updates itself); None when neither is there."""
    search_path = parent_env.get("PATH") or ""
    configured = parent_env.get("CLAUDE_CODE_PATH") or ""
    # It runs in an empty folder of its own, where a relative path finds nothing.
    if configured and (os.path.isabs(configured) or not os.path.dirname(configured)):
        found = shutil.which(configured, path=search_path)
        if found:
            return found
    return shutil.which("claude", path=search_path)


def installed(parent_env: Mapping[str, str] = os.environ) -> bool:
    """Whether there is a program to run (looked for, never run)."""
    return program(parent_env) is not None


def ask_claude_code(system_prompt: str, prompt: str | list[dict[str, Any]], json_schema: dict[str, Any], effort: str, run: Runner = run_program, parent_env: Mapping[str, str] = os.environ) -> ModelResult:
    """Asks Claude Code once for a JSON answer following json_schema. The
    prompt is text, or content blocks (a photo first, then text)."""
    binary = program(parent_env)
    if binary is None:
        return ModelResult(kind="error", error_name="ClaudeCodeNotFound")
    streamed = not isinstance(prompt, str)
    model = parent_env.get("ANTHROPIC_MODEL") or "claude-sonnet-5-5"
    with tempfile.TemporaryDirectory(prefix="ansa-claude-code-") as folder:
        try:
            code, output = run(arguments(binary, system_prompt, json_schema, model, effort, streamed), stdin_text(prompt), folder, environment(parent_env))
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
    return read_result(output.decode("utf-8", errors="replace"), streamed)


def read_result(output: str, streamed: bool = False) -> ModelResult:
    """What `claude -p` printed: its structured_output, whole. Streamed, it
    printed one JSON message a line, the result last."""
    parsed = last_result(output) if streamed else parse_json(output)
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


def parse_json(text: str) -> Any:
    """The JSON value, or None when it isn't JSON."""
    try:
        return json.loads(text)
    except ValueError:
        return None


def last_result(output: str) -> Any:
    """The last line holding the run's result message (type "result"), or None."""
    for line in reversed(output.splitlines()):
        message = parse_json(line)
        if isinstance(message, dict) and message.get("type") == "result":
            return message
    return None
