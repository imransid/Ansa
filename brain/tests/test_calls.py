import json

from brain import ai
from brain.calls.decision import CallRequest, decide
from brain.calls.evidence import find_confirmation
from brain.calls.transcript import build_slice, parse_turns

OPENING = ["AI: Thanks for calling. How can I help?", "User: My card was charged twice for one order.", "AI: Let me look at your account. I can see both charges.", "User: Okay."]


def call(*last_lines: str) -> str:
    return "\n".join([*OPENING, *last_lines])


def confirms(transcript: str, evidence: str) -> bool:
    return find_confirmation(evidence, build_slice(transcript)) is not None


def test_only_a_whole_confirming_sentence_of_the_customer_counts():
    # The old backend's probes (scripts/tenant-isolation/brain-evidence-probes.ts).
    refused = [
        (call("AI: I refunded it.", "User: Thank you, but honestly it still doesn't work.", "AI: Goodbye."), "Thank you"),
        (call("AI: I reset your account.", "User: I don't think it's working now.", "AI: Goodbye."), "it's working now"),
        (call("AI: Refunded.", "User: Has that fixed it? I still see two charges.", "AI: It takes days."), "Has that fixed it?"),
        (call("AI: Refunded.", "User: has that fixed it", "AI: It takes days."), "has that fixed it"),
        (call("AI: Refunded.", "User: That fixed it, right", "AI: It should."), "That fixed it, right"),
        (call("AI: Refunded.", "User: That works.", "AI: Goodbye."), "That works."),
        (call("AI: Refunded.", "User: Okay, done. That fixed it, thanks a lot.", "AI: Goodbye."), "Okay, done. That fixed it, thanks a lot."),
        (call("AI: Refunded.", "User: That fixed it, thank you.", "AI: Great.", "User: Wait, I see it again.", "AI: Let me check.", "User: No, it is still charged twice."), "That fixed it, thank you."),
        (call("AI: Refunded.", "User: Okay... that fixed it for now.", "AI: Bye."), "that fixed it for now."),
        (call("AI: Refunded.", "User: I don't think Dr. Lee's fix is working now.", "AI: Bye."), "Lee's fix is working now."),
        ("\n".join(["AI: Hello", "User: Yes, that fixed it, thank you.", "AI: Good.", "User: Bye."]), "Yes, that fixed it, thank you."),
        (call("AI: Refunded.", "User: Okay, is it fixed now", "AI: Yes."), "Okay, is it fixed now"),
    ]
    for transcript, evidence in refused:
        assert not confirms(transcript, evidence), evidence
    accepted = call("AI: I refunded the second charge.", "User: “Yes,  that fixed it, THANK you.”", "AI: Goodbye.")
    assert find_confirmation("yes, that fixed it, thank you", build_slice(accepted)) == "“Yes, that fixed it, THANK you.”"


def test_a_label_inside_a_line_is_something_someone_said():
    turns = parse_turns("AI: Your note says Customer: wants a refund\nUser: Yes please")
    assert [turn.speaker for turn in turns] == ["agent", "customer"]
    one_line = parse_turns("AI: Hello there User: Hi")
    assert [turn.speaker for turn in one_line] == ["agent", "customer"]


def test_the_slice_hides_secrets_keeps_the_end_and_never_gets_too_long():
    long_turn = "word " * 400 + "Oh wait, it is NOT fixed."
    piece = build_slice(call(*[f"AI: step {i}" for i in range(30)], "User: My card 4111 1111 1111 1111 and a@b.com <tag>", f"User: {long_turn}"))
    texts = [turn.text for turn in piece.closing]
    assert "4111" not in texts[-2] and "[email]" in texts[-2] and "<" not in texts[-2]
    assert texts[-1].endswith("Oh wait, it is NOT fixed.") and "characters left out" in texts[-1]
    assert piece.omitted_turns > 0 and sum(len(t.text) for t in piece.opening + piece.closing) <= 8_000


def asker(answer):
    return lambda system, prompt, schema, use, key: ai.ModelResult(kind="ok", output_text=answer if isinstance(answer, str) else json.dumps(answer))


GOOD = {"outcome": "solved", "customer_issue": "Charged twice.", "resolution_evidence": "Yes, that fixed it, thank you.", "reason": "Refunded.", "ticket_subject": "Double charge", "category": ""}


def test_the_decision_never_turns_a_failure_into_solved():
    request = CallRequest(transcript=call("AI: I refunded it.", "User: Yes, that fixed it, thank you.", "AI: Bye."), categories=["Billing"])
    assert decide(request, asker(GOOD), ai.CALL_DECISION)["outcome"] == "solved"
    made_up = {**GOOD, "resolution_evidence": "All good now, thanks a lot."}
    assert decide(request, asker(made_up), ai.CALL_DECISION)["reason_code"] == "unverified_resolution"
    assert decide(request, asker({**GOOD, "extra": 1}), ai.CALL_DECISION)["reason_code"] == "invalid_output"
    long_needs_human = {**GOOD, "outcome": "needs_human", "ticket_subject": "x" * 90, "category": "Billing"}
    salvaged = decide(request, asker(long_needs_human), ai.CALL_DECISION)
    assert salvaged["reason_code"] == "trimmed_output" and len(salvaged["ticket_subject"]) == 80 and salvaged["category"] == "Billing"
    assert decide(request, asker({**GOOD, "ticket_subject": "x" * 90}), ai.CALL_DECISION)["reason_code"] == "invalid_output"
    failed = decide(request, lambda *args: ai.ModelResult(kind="error", error_name="APITimeoutError"), ai.CALL_DECISION)
    assert failed["reason_code"] == "model_error" and failed["error_name"] == "APITimeoutError"
    assert decide(CallRequest(transcript="AI: Hello?"), asker(GOOD), ai.CALL_DECISION)["reason_code"] == "no_customer_speech"
    assert decide(CallRequest(transcript=call("User: hi"), ended_reason="customer-did-not-answer"), asker(GOOD), ai.CALL_DECISION)["reason_code"] == "abnormal_end"
