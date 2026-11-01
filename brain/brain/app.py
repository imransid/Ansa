"""The brain's web service. It listens only on a private address (127.0.0.1
in development), accepts only requests core signed, keeps no state between
requests and never touches the database.

Run: BRAIN_SHARED_SECRET=... .venv/bin/uvicorn brain.app:create_app --factory --host 127.0.0.1 --port 8090
"""

import os

from fastapi import FastAPI, Request, Response

from brain import ai, claude_code
from brain.assistant.answer import read_answer
from brain.assistant.models import ReplyRequest
from brain.assistant.prompt import build_request
from brain.email.triage import SYSTEM_PROMPT as TRIAGE_SYSTEM_PROMPT
from brain.email.triage import TriageRequest
from brain.email.triage import build_prompt as build_triage_prompt
from brain.email.triage import json_schema as triage_schema
from brain.email.triage import read_answer as read_triage_answer
from brain.menu.reading import JSON_SCHEMA as MENU_JSON_SCHEMA
from brain.menu.reading import SAMPLE_ITEMS, MenuReadRequest, build_content, read_rows
from brain.menu.reading import SYSTEM_PROMPT as MENU_SYSTEM_PROMPT
from brain.security import SIGNATURE_HEADER, TIMESTAMP_HEADER, is_signed_by_core
from brain.settings import Settings, load_settings

# The biggest request core sends (one conversation's slice and the company's details).
MAX_BODY_BYTES = 512 * 1024
# A menu to read: a photo or a PDF of up to 4 MB, as base64.
MENU_BODY_BYTES = 6 * 1024 * 1024


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds the app. Tests pass their own settings."""
    active = settings or load_settings()
    app = FastAPI(title="ansa brain", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def only_core(request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        body = await request.body()
        cap = MENU_BODY_BYTES if request.url.path == "/v1/menu/read" else MAX_BODY_BYTES
        if len(body) > cap:
            return Response(status_code=413)
        if not is_signed_by_core(active.shared_secret, request.headers.get(TIMESTAMP_HEADER), request.headers.get(SIGNATURE_HEADER), body):
            return Response(status_code=401)
        return await call_next(request)

    @app.get("/health")
    async def health() -> Response:
        return Response(status_code=200)

    @app.post("/v1/ping")
    async def ping() -> dict[str, str]:
        """A signed no-op: core uses it to check the connection at start."""
        return {"status": "ok"}

    @app.post("/v1/status")
    async def status() -> dict[str, bool]:
        """What the brain can answer with: ansa's own key, and Claude Code
        (development only). Core shows it as "the AI is ready". Never the key."""
        return {"ansa_key": bool(os.environ.get("ANTHROPIC_API_KEY")), "claude_code": active.development}

    # A plain def on purpose: FastAPI runs it in a worker thread, so a model
    # call that takes seconds never holds up the other requests.
    @app.post("/v1/assistant/reply")
    def assistant_reply(request: ReplyRequest) -> dict:
        """One answer to a customer's newest message, as a decision for core.
        Never the prompt or the model's raw text in a log."""
        return decide_reply(request, asker_for(request.engine, active.development))

    @app.post("/v1/menu/read")
    def menu_read(request: MenuReadRequest) -> dict:
        """A menu read into rows for the owner to check (core prices them). Without
        a key: the development sample, or unavailable in production."""
        return read_menu(request, active_asker, active.development)

    @app.post("/v1/email/triage")
    def email_triage(request: TriageRequest) -> dict:
        """A received email's summary, subject and category (or why not)."""
        return triage_email(request, active_asker)

    return app


def triage_email(request: TriageRequest, asker) -> dict:
    result = asker(TRIAGE_SYSTEM_PROMPT, build_triage_prompt(request), triage_schema(request.categories), ai.EMAIL_TRIAGE, None)
    if result.kind == "unavailable":
        return {"kind": "failed", "reason": "model_unavailable"}
    if result.kind != "ok":
        return {"kind": "failed", "reason": "model_failed", "error_name": result.error_name or result.kind}
    answer = read_triage_answer(result.output_text, request.categories)
    return {"kind": "ok", **answer} if answer is not None else {"kind": "failed", "reason": "unusable_answer"}


def read_menu(request: MenuReadRequest, asker, development: bool) -> dict:
    content = build_content(request)
    if content is None:
        return {"kind": "failed", "reason": "nothing_to_read"}
    result = asker(MENU_SYSTEM_PROMPT, content, MENU_JSON_SCHEMA, ai.MENU_READING, None)
    if result.kind == "unavailable":
        return {"kind": "stand_in", "rows": SAMPLE_ITEMS} if development else {"kind": "failed", "reason": "model_unavailable"}
    if result.kind != "ok":
        return {"kind": "failed", "reason": "model_failed", "error_name": result.error_name or result.kind}
    rows = read_rows(result.output_text)
    return {"kind": "ok", "rows": rows} if rows is not None else {"kind": "failed", "reason": "unusable_answer"}


# The model the endpoint asks; tests replace it with a fake (never the real API in a test).
def active_asker(system_prompt: str, prompt: str, schema: dict, use: ai.UseSettings, api_key: str | None) -> ai.ModelResult:
    return ai.ask(system_prompt, prompt, schema, use, api_key)


def claude_code_asker(system_prompt: str, prompt: str, schema: dict, use: ai.UseSettings, api_key: str | None) -> ai.ModelResult:
    return claude_code.ask_claude_code(system_prompt, prompt, schema, use.effort)


def asker_for(engine: str, development: bool):
    """The model for this business's engine, or None when it isn't allowed here."""
    if engine == "claude_code":
        return claude_code_asker if development else None
    return active_asker


def decide_reply(request: ReplyRequest, asker) -> dict:
    """Asks the model and reads its answer; any failure is a decision core
    turns into the holding reply and an alert."""
    if asker is None:
        return {"kind": "failed", "reason": "model_unavailable"}
    system_prompt, prompt, schema = build_request(request)
    result = asker(system_prompt, prompt, schema, ai.ASSISTANT_REPLY, request.api_key)
    if result.kind == "unavailable":
        return {"kind": "failed", "reason": "model_unavailable"}
    if result.kind != "ok":
        return {"kind": "failed", "reason": "model_failed", "error_name": result.error_name or result.kind}
    decision = read_answer(result.output_text)
    return decision if decision is not None else {"kind": "failed", "reason": "unusable_answer"}
