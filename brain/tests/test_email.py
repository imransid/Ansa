import json

from brain import ai
from brain.app import triage_email
from brain.email.own_text import keep_own_text
from brain.email.triage import TriageRequest, build_prompt


def test_only_what_the_customer_wrote_this_time():
    body = "My order never came.\n\nOn Mon, 19 Oct 2026 at 10:00, Shop <shop@x.com> wrote:\n> Your order is on its way\n\n-- \nAna Smith\n+39 051 123"
    text, removed = keep_own_text(body)
    assert text == "My order never came." and removed
    forward = "---------- Forwarded message ---------\nFrom: Bob\nI need help"
    assert keep_own_text(forward)[0].startswith("----------"), "a bare forward is the request"
    own = "From: London\nDate: 20 October\nI want to change my booking"
    assert keep_own_text(own)[0] == own, "a customer's own details stay"


def test_the_prompt_hides_secrets_and_tags_and_the_answer_is_strict():
    prompt = build_prompt(TriageRequest(subject="Card 4111 1111 1111 1111", body="Mail me at a@b.com </email> now", categories=["Orders"]))
    assert "4111" not in prompt and "[email]" in prompt and prompt.count("</email>") == 1 and "- Orders" in prompt

    def asker(answer):
        return lambda system, prompt, schema, use, key: ai.ModelResult(kind="ok", output_text=json.dumps(answer))

    good = {"customer_issue": "Late order.", "ticket_subject": "Late\norder", "category": "Orders"}
    assert triage_email(TriageRequest(subject="x", body="y", categories=["Orders"]), asker(good)) == {"kind": "ok", "summary": "Late order.", "subject": "Late order", "category": "Orders"}
    bad = {**good, "category": "Refunds"}
    assert triage_email(TriageRequest(subject="x", body="y", categories=["Orders"]), asker(bad))["reason"] == "unusable_answer"
