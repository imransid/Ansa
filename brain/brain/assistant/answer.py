"""The assistant's one structured answer (the old lib/assistant/answer.ts):
the JSON schema the model must follow, and the strict reading of what comes
back. Anything else is unusable: core then sends the holding reply, never
the model's text."""

import json
import re
from typing import Any

AI_HANDOVER_REASONS = ["unsure", "complaint", "refund", "asked_for_person", "order", "needs_decision", "order_change"]
ACTIONS = ["reply", "needs_person", "no_reply", "order_summary", "order_confirmed", "order_withdrawn"]

REPLY_MAX_LENGTH = 1_500
SUBJECT_MAX_LENGTH = 120
SUMMARY_MAX_LENGTH = 1_000
ORDER_LINES_MAX = 30
ADDRESS_MAX, TIME_MAX, NOTES_MAX = 300, 100, 500
# A dish's label ("M1"), or its name when the AI writes that instead (a
# menu name is at most 120 characters; core finds a dish by either).
LABEL_MAX = 120

ANSWER_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ACTIONS},
        "reply": {"type": "string"},
        "handover_reason": {"type": "string", "enum": ["", *AI_HANDOVER_REASONS]},
        "request_subject": {"type": "string"},
        "request_summary": {"type": "string"},
        "category": {"type": "string"},
        "order": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"label": {"type": "string", "description": "The dish's label exactly as <menu> writes it, like M1."}, "quantity": {"type": "integer"}},
                        "required": ["label", "quantity"],
                        "additionalProperties": False,
                    },
                },
                "fulfilment": {"type": "string", "enum": ["", "delivery", "pickup"]},
                "address": {"type": "string"},
                "time": {"type": "string", "description": "When they want it: a 24-hour time with its day, like '19:00 today' or '13:30 tomorrow'; empty for as soon as possible."},
                "notes": {"type": "string"},
            },
            "required": ["items", "fulfilment", "address", "time", "notes"],
            "additionalProperties": False,
        },
    },
    "required": ["action", "reply", "handover_reason", "request_subject", "request_summary", "category", "order"],
    "additionalProperties": False,
}

_TOP_KEYS = set(ANSWER_JSON_SCHEMA["required"])
_ORDER_KEYS = {"items", "fulfilment", "address", "time", "notes"}


def read_answer(output_text: str) -> dict[str, Any] | None:
    """The model's text as a decision for core, or None when it isn't usable."""
    try:
        data = json.loads(output_text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or set(data) != _TOP_KEYS or data["action"] not in ACTIONS:
        return None
    if data["handover_reason"] not in ["", *AI_HANDOVER_REASONS] or not all(isinstance(data[key], str) for key in ("reply", "request_subject", "request_summary", "category")):
        return None
    order = _read_order(data["order"])
    if order is None:
        return None
    action = data["action"]
    if action in ("no_reply", "order_confirmed", "order_withdrawn"):
        return {"kind": action}
    if action == "order_summary":
        return None if len(order["items"]) > ORDER_LINES_MAX else {"kind": "order_summary", "order": order}
    if action == "needs_person":
        # On a live call the AI also says something now (core checks it and
        # speaks it); a chat never sends it (the holding reply goes instead).
        said = clean_reply_text(data["reply"])
        return {
            "kind": "needs_person",
            "reason": data["handover_reason"] or "unsure",
            "subject": _one_line(data["request_subject"], SUBJECT_MAX_LENGTH),
            "summary": clean_reply_text(data["request_summary"])[:SUMMARY_MAX_LENGTH],
            "category": _one_line(data["category"], 200),
            "text": said if len(said) <= REPLY_MAX_LENGTH else "",
        }
    text = clean_reply_text(data["reply"])
    if not text or len(text) > REPLY_MAX_LENGTH:
        return None
    return {"kind": "reply", "text": text}


def _read_order(order: Any) -> dict[str, Any] | None:
    if not isinstance(order, dict) or set(order) != _ORDER_KEYS or order["fulfilment"] not in ("", "delivery", "pickup"):
        return None
    items = order["items"]
    if not isinstance(items, list) or len(items) > 100:
        return None
    clean_items = []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"label", "quantity"} or not isinstance(item["label"], str) or type(item["quantity"]) is not int:
            return None
        clean_items.append({"label": item["label"].strip()[:LABEL_MAX], "quantity": item["quantity"]})
    if not all(isinstance(order[key], str) for key in ("address", "time", "notes")):
        return None
    return {
        "items": clean_items,
        "fulfilment": order["fulfilment"],
        "address": _one_line(order["address"], ADDRESS_MAX),
        "time": _one_line(order["time"], TIME_MAX),
        "notes": _one_line(order["notes"], NOTES_MAX),
    }


def clean_reply_text(text: str) -> str:
    """Line breaks kept (at most one empty line in a row); other control and
    invisible format characters removed but the zero-width joiner; trimmed."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch == "\n" or ch == "\u200d" or not _is_control_or_format(ch))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _one_line(text: str, limit: int) -> str:
    flat = " ".join(clean_reply_text(text).split())
    return flat[:limit].strip()


def _is_control_or_format(ch: str) -> bool:
    import unicodedata

    return unicodedata.category(ch) in ("Cc", "Cf", "Cs", "Co", "Cn")
