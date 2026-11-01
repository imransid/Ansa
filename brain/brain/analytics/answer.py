"""Reading the AI's performance review strictly (the old
lib/performance-review/review-answer.ts, its Zod half): exactly the three
lists, each entry exactly its fields (a field we didn't ask for makes the
answer unusable), at most 50 of each, numbers that are numbers. Core then
checks every number a finding cites before anything is saved."""

import json
import math
from typing import Any

# The answer's lists are refused past this (the old schema's .max(50)).
ANSWER_LIST_MAX = 50


def read_answer(output_text: str) -> dict[str, Any] | None:
    """Exactly the three lists, each entry exactly its fields (a field we
    didn't ask for makes the answer unusable), at most 50 of each."""
    try:
        data = json.loads(output_text, parse_constant=_refuse)
    except (ValueError, TypeError):
        return None
    if not _is_object(data, {"findings", "recommendations", "limits_of_this_data"}):
        return None
    findings = [_finding(entry) for entry in _list(data["findings"])]
    recommendations = [_recommendation(entry) for entry in _list(data["recommendations"])]
    limits = _list(data["limits_of_this_data"])
    if None in findings or None in recommendations or limits is None or not all(isinstance(limit, str) for limit in limits):
        return None
    return {"findings": findings, "recommendations": recommendations, "limits_of_this_data": limits}


def _finding(entry: Any) -> dict[str, Any] | None:
    if not _is_object(entry, {"text", "evidence"}) or not isinstance(entry["text"], str):
        return None
    evidence = [_evidence(cited) for cited in _list(entry["evidence"])]
    return None if None in evidence or _list(entry["evidence"]) is None else {"text": entry["text"], "evidence": evidence}


def _evidence(entry: Any) -> dict[str, Any] | None:
    if not _is_object(entry, {"post_label", "group", "metric", "value"}) or not _is_number(entry["value"]):
        return None
    if not all(isinstance(entry[key], str) for key in ("post_label", "group", "metric")):
        return None
    return {"post_label": entry["post_label"], "group": entry["group"], "metric": entry["metric"], "value": entry["value"]}


def _recommendation(entry: Any) -> dict[str, Any] | None:
    if not _is_object(entry, {"text", "based_on_findings"}) or not isinstance(entry["text"], str):
        return None
    numbers = _list(entry["based_on_findings"])
    # A whole number within JavaScript's safe range (1.0 is one).
    if numbers is None or not all(_is_number(n) and float(n).is_integer() and abs(n) <= 2**53 - 1 for n in numbers):
        return None
    return {"text": entry["text"], "based_on_findings": [int(n) for n in numbers]}


def _is_object(value: Any, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys


def _list(value: Any) -> list[Any] | None:
    return value if isinstance(value, list) and len(value) <= ANSWER_LIST_MAX else None


def _is_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def _refuse(constant: str) -> None:
    """NaN and Infinity are not JSON (JavaScript's parser refuses them)."""
    raise ValueError(constant)
