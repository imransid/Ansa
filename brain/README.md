# brain: ansa's AI thinking (Python)

The brain only thinks. Core sends it one company's slice of data (signed);
the brain asks the AI model and returns a proposal; core checks it before
anything reaches a customer. The brain has no database access and keeps no
state. Read `docs/backend/README.md` first.

## Run it on your laptop
1. `cd brain && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`
2. `BRAIN_SHARED_SECRET=<the same value as core's> .venv/bin/uvicorn brain.app:create_app --factory --host 127.0.0.1 --port 8090`
3. Check it: `curl -i http://127.0.0.1:8090/health`.

## Test it
`.venv/bin/python -m pytest -q`

## Files
| File | What | Docs |
|---|---|---|
| `brain/app.py` | The web service; only core's signed requests pass | [brain-service](../docs/backend/modules/brain-service.md) |
| `brain/security.py` | Checks core's signature | [brain-service](../docs/backend/modules/brain-service.md) |
| `brain/settings.py` | Settings, checked at start | [brain-service](../docs/backend/modules/brain-service.md) |
| `brain/ai.py` | The only door to the AI model | [brain-assistant](../docs/backend/modules/brain-assistant.md) |
| `brain/assistant/` | The reply's prompt, answer and models | [brain-assistant](../docs/backend/modules/brain-assistant.md) |
| `brain/text.py` | Escaping and hiding secrets in prompts | [brain-assistant](../docs/backend/modules/brain-assistant.md) |
