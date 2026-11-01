import json
import time

from fastapi.testclient import TestClient

from brain import ai
from brain.app import create_app, write_post
from brain.posts.autopost import PostBusiness, PostChoice, PostRequest, build_prompt, read_answer
from brain.settings import Settings
from tests.test_security import SECRET, sign


def request(**changes) -> PostRequest:
    base = dict(
        business=PostBusiness(name="Luigi's", type="Restaurant", description="Pizza <b>since</b> 1998"),
        offers=["Margherita | €9.50 | Tomato and mozzarella", "Card 4111 1111 1111 1111"],
        words_to_avoid=["cheap"],
        post=PostChoice(kind_label="Something you offer", topic="Margherita", item_name="Margherita", day="Friday 2026-11-06"),
    )
    return PostRequest(**{**base, **changes})


def asker(answer):
    return lambda system, prompt, schema, use, key: ai.ModelResult(kind="ok", output_text=json.dumps(answer) if not isinstance(answer, str) else answer)


def test_the_prompt_holds_only_the_business_escaped():
    prompt = build_prompt(request())
    assert "&lt;b&gt;since&lt;/b&gt;" in prompt and "4111" not in prompt and "[number]" in prompt
    assert "<words_to_avoid>\ncheap\n</words_to_avoid>" in prompt and "Subject: Margherita" in prompt and "<hours>\nNot given.\n</hours>" in prompt


def test_the_answer_is_strict_and_cleaned():
    good = {"body": "Our Margherita is back.\n\n\n\nCome try it!", "call_to_action": "Book\na table", "hashtags": ["#pizza", "food truck", "x" * 61, "a", "b", "c"]}
    written = write_post(request(), asker(good))
    assert written == {"kind": "ok", "body": "Our Margherita is back.\n\nCome try it!", "call_to_action": "Book a table", "hashtags": ["pizza", "foodtruck", "a", "b"]}
    assert read_answer(json.dumps({**good, "extra": 1})) is None
    assert read_answer(json.dumps({**good, "body": "x" * 1_501})) is None
    assert read_answer("not json") is None
    assert write_post(request(), asker({**good, "body": "   "}))["reason"] == "unusable_answer"


def test_without_a_model_nothing_is_written():
    assert write_post(request(), None) == {"kind": "failed", "reason": "model_unavailable"}
    failed = write_post(request(), lambda *args: ai.ModelResult(kind="error", error_name="APITimeoutError"))
    assert failed == {"kind": "failed", "reason": "model_failed", "error_name": "APITimeoutError"}


def test_an_unknown_field_is_refused():
    client = TestClient(create_app(Settings(shared_secret=SECRET)))
    body = json.dumps({**request().model_dump(), "company_id": "x"}).encode()
    answer = client.post("/v1/posts/write", content=body, headers=sign(body, int(time.time())))
    assert answer.status_code == 422
