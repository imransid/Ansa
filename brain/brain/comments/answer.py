"""The AI's one structured proposal for a comment: the JSON schema the model
follows, and the strict reading of what comes back. Anything else is
unusable: core then hands the comment to a person, never sending the
model's text."""

import json
from typing import Any

from brain.assistant.answer import clean_reply_text

KINDS = ["question", "order", "complaint", "thanks", "spam", "unsure"]

PUBLIC_REPLY_MAX = 300
PRIVATE_MESSAGE_MAX = 1_500
SUBJECT_MAX = 120
SUMMARY_MAX = 1_000

ANSWER_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": KINDS},
        "public_reply": {"type": "string", "description": "question only: the public answer under the comment, one or two sentences."},
        "private_message": {"type": "string", "description": "order only: the Messenger message to the commenter, with the menu's own prices."},
        "request_subject": {"type": "string"},
        "request_summary": {"type": "string"},
        "category": {"type": "string"},
    },
    "required": ["kind", "public_reply", "private_message", "request_subject", "request_summary", "category"],
    "additionalProperties": False,
}

_KEYS = set(ANSWER_JSON_SCHEMA["required"])


def read_answer(output_text: str) -> dict[str, Any] | None:
    """The model's text as a proposal for core, or None when it isn't usable:
    a question needs its public reply, an order its private message, each
    within its length; a complaint or unsure their subject and summary."""
    try:
        data = json.loads(output_text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or set(data) != _KEYS or data["kind"] not in KINDS:
        return None
    if not all(isinstance(data[key], str) for key in _KEYS):
        return None
    kind = data["kind"]
    proposal = {"kind": kind, "public_reply": "", "private_message": "", "subject": "", "summary": "", "category": ""}
    if kind == "question":
        reply = _one_line(data["public_reply"])
        if not reply or len(reply) > PUBLIC_REPLY_MAX:
            return None
        proposal["public_reply"] = reply
    elif kind == "order":
        message = clean_reply_text(data["private_message"])
        if not message or len(message) > PRIVATE_MESSAGE_MAX:
            return None
        proposal["private_message"] = message
    elif kind in ("complaint", "unsure"):
        proposal["subject"] = _one_line(data["request_subject"])[:SUBJECT_MAX].strip()
        proposal["summary"] = clean_reply_text(data["request_summary"])[:SUMMARY_MAX]
        proposal["category"] = _one_line(data["category"])[:200].strip()
    return proposal


def _one_line(text: str) -> str:
    return " ".join(clean_reply_text(text).split())
