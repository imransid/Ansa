# brain: the assistant (brain/brain/assistant/, brain/brain/ai.py)

**What:** the thinking behind one reply to a customer. Core sends
`POST /v1/assistant/reply` (signed) with ONE company's slice (`models.py`,
strict: an unknown field is refused); the brain answers a decision.
**Prompt (`prompt.py`):** the same words as the old `lib/assistant/prompt.ts`
and `order-prompt.ts`: a business's or a person's system prompt, and the data
in tags (business, hours, ordering, menu with labels, the order in progress
and placed orders, the owner's instructions, articles, categories, the newest
20 messages of this one conversation). Every value escaped (`text.py`); the
customer's words with card-like and social-security-like numbers and email
addresses hidden, the owner's with secret numbers hidden.
**Model (`ai.py`):** Anthropic's SDK, one structured JSON answer
(`output_config.format: json_schema`), effort low, 3,000 tokens, 30 s, one
retry; the business's own key when core sends one, else ansa's; on an error
only the class name is kept (never its text).
**Answer (`answer.py`):** read strictly: exactly the schema's fields;
`reply` (1–1,500 characters, cleaned), `needs_person` (a reason from the
allowed list, a one-line subject, a summary, a category), `no_reply`,
`order_summary` (items by label with whole quantities), `order_confirmed`,
`order_withdrawn`. Anything else, or no model, or a failure, is
`{"kind":"failed","reason": model_unavailable | model_failed | unusable_answer}`:
core then sends the holding reply, never the model's text.
**Core's checks (prices, links, refunds) run in core, not here.**
**Tests:** `tests/test_assistant.py` (a fake model): the prompt's contents,
escaping and hiding; a person's prompt; strict reading; failures; the
endpoint needs core's signature.
