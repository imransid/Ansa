"""What every Co-Founder prompt shares (the old lib/cofounder/prompt-text.ts
and fact-proposals.ts): a company's text inside tags it can't break out of,
the profile's topics with their status, and reading proposed facts.

Prompt-injection rule: what the owner typed, and every stored value, is
data, never instructions. Each sits inside its own tags with its text
escaped, so nothing in it can close the tag around it or open another, and
the model has no tools. Lengths are counted as the old JavaScript did
(UTF-16 units), so both backends cut at the same place."""

import json
import re
import unicodedata
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from brain import ai
from brain.text import escape_html, redact_secret_numbers

# How much of each fact's value the interview and the suggestions read.
FACT_CHARACTERS_FOR_AI = 300
# The longest fact, confirmed or proposed.
FACT_MAX_LENGTH = 2_000

TOPICS_PROMPT_RULE = (
    '<topics> lists every topic of the business profile by its key, with its status: "confirmed" (the owner confirmed the value in <confirmed>), '
    '"proposed" (the value in <proposed> waits for the owner to confirm it) or "missing". A confirmed topic can also have a proposed correction waiting. '
    'key_fact="yes" marks the key facts; the order of the topics is their order of importance.'
)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BrainTopic(Strict):
    """One topic of the profile as core sends it ("" = no value)."""

    key: str = Field(pattern=r"^[a-z_]{1,40}$")
    label: str = Field(max_length=100)
    key_fact: bool
    confirmed: str = Field(default="", max_length=FACT_MAX_LENGTH)
    proposed: str = Field(default="", max_length=FACT_MAX_LENGTH)


def utf16_length(text: str) -> int:
    """.length as JavaScript counts it: two units for a character past U+FFFF."""
    return sum(2 if ord(ch) >= 0x10000 else 1 for ch in text)


def cut_to_length(text: str, max_length: int) -> str:
    """At most max_length UTF-16 units, never half a character, no spaces at the end once cut."""
    if utf16_length(text) <= max_length:
        return text
    units = 0
    for index, ch in enumerate(text):
        width = 2 if ord(ch) >= 0x10000 else 1
        if units + width > max_length:
            return text[:index].rstrip()
        units += width
    return text


def redacted_and_cut(text: str, max_length: int) -> str:
    """Secret numbers hidden BEFORE the cut (a cut can't leave half a card
    number showing), then cut with the cut marked."""
    text = redact_secret_numbers(text).strip()
    if utf16_length(text) <= max_length:
        return text
    kept = cut_to_length(text, max_length)
    return f"{kept} [... {utf16_length(text) - utf16_length(kept)} characters left out ...]"


def text_for_prompt(text: str, max_length: int) -> str:
    """Hidden, cut, then escaped (AFTER the cut, so a cut never splits an escaped character)."""
    return escape_html(redacted_and_cut(text, max_length))


def topics_block(topics: list[BrainTopic]) -> str:
    """Every topic in the interview's order, with its status and values (each cut to 300)."""
    return "<topics>\n" + "\n".join(_topic_element(topic) for topic in topics) + "\n</topics>"


def _topic_element(topic: BrainTopic) -> str:
    status = "confirmed" if topic.confirmed else ("proposed" if topic.proposed else "missing")
    key_fact = "yes" if topic.key_fact else "no"
    opening = f'<topic key="{escape_html(topic.key)}" label="{escape_html(topic.label)}" key_fact="{key_fact}" status="{status}">'
    parts = []
    if topic.confirmed:
        parts.append(f"<confirmed>{text_for_prompt(topic.confirmed, FACT_CHARACTERS_FOR_AI)}</confirmed>")
    if topic.proposed:
        parts.append(f"<proposed>{text_for_prompt(topic.proposed, FACT_CHARACTERS_FOR_AI)}</proposed>")
    return f"{opening}</topic>" if not parts else opening + "\n" + "\n".join(parts) + "\n</topic>"


def plain_single_line(text: str) -> str:
    """One plain line: line breaks and other control characters become
    spaces, invisible format characters go, runs of spaces become one."""
    kept = []
    for ch in text:
        category = unicodedata.category(ch)
        if category in ("Cc", "Zl", "Zp"):
            kept.append(" ")
        elif category != "Cf":
            kept.append(ch)
    return " ".join("".join(kept).split())


def clean_fact_value(text: str) -> str:
    """A value as a fact holds it: \\n line breaks, no control characters but
    line breaks and tabs, at most one blank line in a row, trimmed, at most 2,000."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch) != "Cc")
    return cut_to_length(re.sub(r"\n{3,}", "\n\n", text).strip(), FACT_MAX_LENGTH)


def proposed_facts_schema(keys: list[str]) -> dict[str, Any]:
    """proposed_facts as the API enforces it: the topic is one core listed."""
    item = {
        "type": "object",
        "properties": {"topic": {"type": "string", "enum": keys}, "value": {"type": "string"}},
        "required": ["topic", "value"],
        "additionalProperties": False,
    }
    return {"type": "array", "items": item}


def read_proposed_facts(entries: list[Any], keys: list[str]) -> list[dict[str, str]]:
    """Each entry on its own: another shape, an unknown topic or an empty
    value drops only itself. One per topic (a later one is a correction)."""
    value_by_topic: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"topic", "value"}:
            continue
        topic, value = entry["topic"], entry["value"]
        if not isinstance(topic, str) or not isinstance(value, str) or topic not in keys:
            continue
        cleaned = clean_fact_value(value)
        if cleaned:
            value_by_topic[topic] = cleaned
    return [{"topic": topic, "value": value} for topic, value in value_by_topic.items()]


def parse_object(output_text: str, fields: set[str]) -> dict[str, Any] | None:
    """The answer as a JSON object with exactly these fields, else None."""
    try:
        data = json.loads(output_text)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) and set(data) == fields else None


def ask_and_read(asker, system_prompt: str, prompt: str, schema: dict[str, Any], use: ai.UseSettings, read: Callable[[str], dict | None]) -> dict:
    """Asks the model and reads its answer: ok with what was read, or failed
    with why (model_unavailable, model_failed with the error's class, unusable_answer)."""
    result = asker(system_prompt, prompt, schema, use, None)
    if result.kind == "unavailable":
        return {"kind": "failed", "reason": "model_unavailable"}
    if result.kind != "ok":
        return {"kind": "failed", "reason": "model_failed", "error_name": result.error_name or result.kind}
    answer = read(result.output_text)
    return {"kind": "ok", **answer} if answer is not None else {"kind": "failed", "reason": "unusable_answer"}
