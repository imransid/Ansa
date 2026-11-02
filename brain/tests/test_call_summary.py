import json

from brain import ai
from brain.assistant.call_summary import CallSummaryRequest, build_prompt, read_summary, summarize_call


def call(**overrides) -> CallSummaryRequest:
    data = {
        "kind": "personal",
        "name": "Rafa <x>",
        "conversation": [
            {"sender": "restaurant", "text": "Hello! I'm Rafa's AI assistant."},
            {"sender": "customer", "text": "This is Mark, call me back tomorrow about the contract. My card is 4111 1111 1111 1111"},
        ],
    }
    data.update(overrides)
    return CallSummaryRequest(**data)


def test_the_note_reads_only_the_call_escaped_with_secrets_hidden():
    prompt = build_prompt(call())
    assert "Rafa &lt;x&gt;" in prompt and "Caller: This is Mark" in prompt and "Assistant: Hello!" in prompt
    assert "4111" not in prompt and "[number]" in prompt


def test_the_note_is_read_strictly():
    good = json.dumps({"subject": "Mark: call back", "summary": "Mark wants a call back tomorrow about the contract.", "needs_person": True})
    assert read_summary(good) == {"subject": "Mark: call back", "summary": "Mark wants a call back tomorrow about the contract.", "needs_person": True}
    assert read_summary(json.dumps({"subject": "x", "summary": "y", "needs_person": "yes"})) is None
    assert read_summary(json.dumps({"subject": "", "summary": "y", "needs_person": True})) is None
    assert read_summary("not json") is None


def test_a_failure_is_a_failed_note():
    def asker(system, prompt, schema, use, api_key):
        assert use is ai.CALL_SUMMARY
        return ai.ModelResult(kind="error", error_name="APITimeoutError")

    assert summarize_call(call(), asker, ai.CALL_SUMMARY) == {"kind": "failed", "reason": "model_failed"}
    assert summarize_call(call(), None, ai.CALL_SUMMARY)["reason"] == "model_unavailable"
