"""The content studio's answer (the old lib/content-studio/draft-json-schema.ts
and the strict half of draft-answer.ts): the JSON schema the API enforces and
the same rules read again here. Strict: a field we didn't ask for makes the
whole answer unusable, so the AI can't decide what its claims are worth or
what its answer belongs to. Core cleans and cuts the texts afterwards."""

import json
from typing import Any

# The most claims a usable answer lists (a claim left out is one nobody checks).
CLAIMS_MAX = 30

TEXT = {"type": "string"}


def json_schema(topic_keys: list[str]) -> dict[str, Any]:
    """The schema the API enforces: every field required, nothing else allowed,
    no "supported" on a claim (core decides that), no lengths (unsupported:
    the prompt says them and core cuts what comes back)."""
    claim = _object_of({"text": TEXT, "fact_topics": {"type": "array", "items": {"type": "string", "enum": list(topic_keys)}}})
    return _object_of(
        {
            "title": TEXT,
            "body": TEXT,
            "hashtags": {"type": "array", "items": TEXT},
            "call_to_action": TEXT,
            "image_prompt": TEXT,
            "video_script": TEXT,
            "claims": {"type": "array", "items": claim},
        }
    )


def _object_of(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


ANSWER_FIELDS = {"title", "body", "hashtags", "call_to_action", "image_prompt", "video_script", "claims"}
TEXT_FIELDS = ("title", "body", "call_to_action", "image_prompt", "video_script")


def read_answer(output_text: str) -> dict[str, Any] | None:
    """Exactly the schema's fields, or nothing: a field we didn't ask for (a
    claim's "supported", a company or a draft id) makes the whole answer
    unusable, and so does a field missing or more than 30 claims."""
    try:
        data = json.loads(output_text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or set(data) != ANSWER_FIELDS:
        return None
    if not all(isinstance(data[field], str) for field in TEXT_FIELDS):
        return None
    hashtags, claims = data["hashtags"], data["claims"]
    if not isinstance(hashtags, list) or not all(isinstance(tag, str) for tag in hashtags):
        return None
    if not isinstance(claims, list) or len(claims) > CLAIMS_MAX or not all(_is_claim(claim) for claim in claims):
        return None
    return {field: data[field] for field in ANSWER_FIELDS}


def _is_claim(claim: Any) -> bool:
    if not isinstance(claim, dict) or set(claim) != {"text", "fact_topics"} or not isinstance(claim["text"], str):
        return False
    topics = claim["fact_topics"]
    return isinstance(topics, list) and all(isinstance(topic, str) for topic in topics)
