"""The shape of a marketing plan (the old plan-json-schema.ts and
plan-schema.ts's keys): the JSON schema the API enforces, and the brain's
strict check of the answer against the same keys at every level. A field
missing, unknown or of another type, an unknown platform or basis makes the
whole answer unusable. Sizes are NOT checked here: core cuts texts and
lists, needs the fewest entries, and applies the fact rule (the same reader
it uses for a stored plan)."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

Platform = Literal["linkedin", "facebook", "x", "youtube"]

_TEXT = {"type": "string"}
_TEXT_LIST = {"type": "array", "items": _TEXT}
_PLATFORM = {"type": "string", "enum": ["linkedin", "facebook", "x", "youtube"]}


def _object_of(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


def _list_of(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "array", "items": _object_of(properties)}


def json_schema(topic_keys: list[str]) -> dict[str, Any]:
    """No company, version or person field; fact_topics only the profile's keys."""
    return _object_of(
        {
            "summary": _TEXT,
            "audiences": _list_of({"name": _TEXT, "needs": _TEXT, "where_to_reach": _TEXT}),
            "positioning": _TEXT,
            "goals": _list_of({"goal": _TEXT, "how_to_measure": _TEXT}),
            "pillars": _list_of({"name": _TEXT, "description": _TEXT, "example_topics": _TEXT_LIST}),
            "campaigns": _list_of(
                {"name": _TEXT, "objective": _TEXT, "pillar": _TEXT, "platforms": {"type": "array", "items": _PLATFORM}, "timing": _TEXT, "call_to_action": _TEXT}
            ),
            "cadence": _list_of({"platform": _PLATFORM, "posts_per_week": {"type": "number"}, "formats": _TEXT_LIST}),
            "statements": _list_of(
                {
                    "text": _TEXT,
                    "basis": {"type": "string", "enum": ["fact", "assumption", "suggestion"]},
                    "fact_topics": {"type": "array", "items": {"type": "string", "enum": topic_keys}},
                }
            ),
            "missing_information": _TEXT_LIST,
            "cautions": _TEXT_LIST,
        }
    )


class _Exact(BaseModel):
    """Every field required, nothing else allowed, no type coercion."""

    model_config = ConfigDict(extra="forbid", strict=True)


class _Audience(_Exact):
    name: str
    needs: str
    where_to_reach: str


class _Goal(_Exact):
    goal: str
    how_to_measure: str


class _Pillar(_Exact):
    name: str
    description: str
    example_topics: list[str]


class _Campaign(_Exact):
    name: str
    objective: str
    pillar: str
    platforms: list[Platform]
    timing: str
    call_to_action: str


class _Cadence(_Exact):
    platform: Platform
    posts_per_week: float
    formats: list[str]


class _Statement(_Exact):
    text: str
    basis: Literal["fact", "assumption", "suggestion"]
    fact_topics: list[str]


class MarketingPlanAnswer(_Exact):
    summary: str
    audiences: list[_Audience]
    positioning: str
    goals: list[_Goal]
    pillars: list[_Pillar]
    campaigns: list[_Campaign]
    cadence: list[_Cadence]
    statements: list[_Statement]
    missing_information: list[str]
    cautions: list[str]


def read_answer(output_text: str) -> dict[str, Any] | None:
    """The plan as the model wrote it, when its shape is exactly the plan's; else None."""
    try:
        answer = MarketingPlanAnswer.model_validate_json(output_text)
    except ValidationError:
        return None
    return {"plan": answer.model_dump()}
