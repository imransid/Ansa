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


@dataclass(frozen=True)
class ModelResult:
    """ok (with output_text), unavailable (no key), refused, truncated, unexpected_stop or error (with error_name)."""

    kind: str
    output_text: str = ""
    error_name: str = ""


def ask(system_prompt: str, prompt: str, json_schema: dict[str, Any], use: UseSettings, api_key: str | None = None) -> ModelResult:
    """Asks the model once for a JSON answer following json_schema."""
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return ModelResult(kind="unavailable")
    client = anthropic.Anthropic(api_key=key, timeout=use.timeout_seconds, max_retries=use.max_retries)
    try:
        response = client.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
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
