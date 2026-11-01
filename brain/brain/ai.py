"""The brain's only door to the AI model (Anthropic's Claude), as the old
adapters/claude.ts: one structured JSON answer per request, a time limit and
retries per use, and nothing logged or traced (never the prompt, the answer
or the SDK's error text, which can quote the answer)."""

import os
from dataclasses import dataclass
from typing import Any

import anthropic


@dataclass(frozen=True)
class UseSettings:
    """How one use asks: effort, answer length, time limit per try, retries."""

    effort: str
    max_tokens: int
    timeout_seconds: float
    max_retries: int


# The restaurant assistant's reply to a customer (who is waiting in a chat).
ASSISTANT_REPLY = UseSettings(effort="low", max_tokens=3_000, timeout_seconds=30, max_retries=1)

# Deciding a finished phone call: solved, or a person follows up.
CALL_DECISION = UseSettings(effort="high", max_tokens=8_000, timeout_seconds=60, max_retries=2)

# Triaging a customer email (a summary, a subject and a category).
EMAIL_TRIAGE = UseSettings(effort="medium", max_tokens=4_000, timeout_seconds=45, max_retries=1)

# "Post for me": one short Facebook post from the business's own details.
AUTOPOST = UseSettings(effort="low", max_tokens=3_000, timeout_seconds=60, max_retries=1)

# "Read my menu": a whole menu copied into a list (long answers, a photo or a PDF).
MENU_READING = UseSettings(effort="low", max_tokens=16_000, timeout_seconds=120, max_retries=1)


@dataclass(frozen=True)
class ModelResult:
    """ok (with output_text), unavailable (no key), refused, truncated, unexpected_stop or error (with error_name)."""

    kind: str
    output_text: str = ""
    error_name: str = ""


def model_name() -> str:
    """The model every use asks (ANTHROPIC_MODEL), stored with a call's decision."""
    return os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")


def ask(system_prompt: str, prompt: str | list[dict[str, Any]], json_schema: dict[str, Any], use: UseSettings, api_key: str | None = None) -> ModelResult:
    """Asks the model once for a JSON answer following json_schema. The prompt
    is text, or content blocks (a photo or a PDF first, then text)."""
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return ModelResult(kind="unavailable")
    client = anthropic.Anthropic(api_key=key, timeout=use.timeout_seconds, max_retries=use.max_retries)
    try:
        response = client.messages.create(
            model=model_name(),
            max_tokens=use.max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
            extra_body={"output_config": {"effort": use.effort, "format": {"type": "json_schema", "schema": json_schema}}},
        )
    except anthropic.APIError as error:
        # The class name only: an SDK error's text can quote the answer.
        return ModelResult(kind="error", error_name=type(error).__name__)
    if response.stop_reason == "refusal":
        return ModelResult(kind="refused")
    if response.stop_reason == "max_tokens":
        return ModelResult(kind="truncated")
    if response.stop_reason != "end_turn":
        return ModelResult(kind="unexpected_stop")
    text = "".join(block.text for block in response.content if block.type == "text")
    return ModelResult(kind="ok", output_text=text)
