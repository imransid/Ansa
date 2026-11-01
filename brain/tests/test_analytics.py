import json
import pathlib
import time

from fastapi.testclient import TestClient

from brain import ai
from brain.analytics.answer import read_answer
from brain.analytics.review import JSON_SCHEMA, SYSTEM_PROMPT, ReviewRequest, build_prompt, review_performance
from brain.app import create_app
from brain.settings import Settings
from tests.test_security import SECRET, sign

# What the OLD TypeScript made of one set of tricky posts (an escaped topic,
# a card number, a long topic with an emoji, a social-security-like pillar,
# pillars sorted as JavaScript sorts): the request core sends for the same
# input, and the prompt, system prompt and schema the old code wrote.
GOLDEN = json.loads((pathlib.Path(__file__).parent / "golden" / "performance_review.json").read_text(encoding="utf-8"))

GOOD = {
    "findings": [{"text": "P5 got the most reactions.", "evidence": [{"post_label": "P5", "group": "", "metric": "reactions", "value": 9}]}],
    "recommendations": [{"text": "Post more like P5.", "based_on_findings": [1.0]}],
    "limits_of_this_data": ["Only 9 posts had numbers."],
}


def asker(answer, seen=None):
    def ask(system, prompt, schema, use, key):
        if seen is not None:
            seen.append((system, prompt, schema, use, key))
        return ai.ModelResult(kind="ok", output_text=answer if isinstance(answer, str) else json.dumps(answer))

    return ask


def test_the_prompt_schema_and_rules_are_the_old_ones_word_for_word():
    request = ReviewRequest(**GOLDEN["request"])
    assert build_prompt(request) == GOLDEN["prompt"]
    assert SYSTEM_PROMPT == GOLDEN["system"]
    assert JSON_SCHEMA == GOLDEN["schema"]
    assert "Card [number]" in GOLDEN["prompt"] and "4111" not in GOLDEN["prompt"] and "[... 189 characters left out ...]" in GOLDEN["prompt"]


def test_the_model_is_asked_once_with_the_reviews_own_settings_and_ansas_key():
    seen = []
    assert review_performance(ReviewRequest(**GOLDEN["request"]), asker(GOOD, seen))["kind"] == "ok"
    system, prompt, schema, use, key = seen[0]
    assert (use.effort, use.max_tokens, use.timeout_seconds, use.max_retries, key) == ("medium", 8_000, 120, 1, None)
    assert system == SYSTEM_PROMPT and prompt == GOLDEN["prompt"] and schema == JSON_SCHEMA


def test_the_answer_is_read_strictly():
    assert read_answer(json.dumps(GOOD))["recommendations"] == [{"text": "Post more like P5.", "based_on_findings": [1]}]
    finding = GOOD["findings"][0]
    refused = [
        {**GOOD, "company_id": "x"},
        {key: value for key, value in GOOD.items() if key != "limits_of_this_data"},
        {**GOOD, "findings": [{**finding, "extra": 1}]},
        {**GOOD, "findings": [{**finding, "evidence": [{**finding["evidence"][0], "value": True}]}]},
        {**GOOD, "findings": [{**finding, "evidence": [{**finding["evidence"][0], "value": "9"}]}]},
        {**GOOD, "recommendations": [{"text": "x", "based_on_findings": [1.5]}]},
        {**GOOD, "limits_of_this_data": ["x"] * 51},
        {**GOOD, "limits_of_this_data": [1]},
    ]
    for answer in refused:
        assert read_answer(json.dumps(answer)) is None, answer
    assert read_answer("Here are my thoughts: views went up.") is None
    assert read_answer('{"findings": [], "recommendations": [], "limits_of_this_data": [NaN]}') is None
    assert read_answer(json.dumps(GOOD).replace("9}", "1e400}")) is None


def test_failures_are_reasons_never_the_models_text():
    request = ReviewRequest(**GOLDEN["request"])
    assert review_performance(request, lambda *args: ai.ModelResult(kind="unavailable")) == {"kind": "failed", "reason": "model_unavailable"}
    failed = review_performance(request, lambda *args: ai.ModelResult(kind="error", error_name="InternalServerError"))
    assert failed == {"kind": "failed", "reason": "model_failed", "error_name": "InternalServerError"}
    assert review_performance(request, lambda *args: ai.ModelResult(kind="refused"))["error_name"] == "refused"
    assert review_performance(request, asker({**GOOD, "extra": 1})) == {"kind": "failed", "reason": "unusable_answer"}


def test_only_cores_signed_request_with_known_numbers_gets_in():
    client = TestClient(create_app(Settings(shared_secret=SECRET)))
    for changed in ({**GOLDEN["request"], "company_id": "x"}, {**GOLDEN["request"], "posts": [{**GOLDEN["request"]["posts"][0], "numbers": {"likes": 3}}]}):
        body = json.dumps(changed).encode()
        assert client.post("/v1/analytics/review", content=body, headers=sign(body, int(time.time()))).status_code == 422
    body = json.dumps(GOLDEN["request"]).encode()
    assert client.post("/v1/analytics/review", content=body, headers={"X-Ansa-Timestamp": str(int(time.time())), "X-Ansa-Signature": "00"}).status_code == 401
