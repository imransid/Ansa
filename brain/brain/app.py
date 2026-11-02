"""The brain's web service. It listens only on a private address (127.0.0.1
in development), accepts only requests core signed, keeps no state between
requests and never touches the database.

Run: BRAIN_SHARED_SECRET=... .venv/bin/uvicorn brain.app:create_app --factory --host 127.0.0.1 --port 8090
"""

import os

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from brain import ai, claude_code
from brain.analytics.review import ReviewRequest, review_performance
from brain.assistant.answer import read_answer
from brain.assistant.models import ReplyRequest
from brain.assistant.prompt import build_request
from brain.calls.decision import CallRequest
from brain.content.draft import DraftRequest, write_draft
from brain.calls.decision import decide as decide_call
from brain.cofounder.calendar import CalendarPlanRequest, plan_calendar
from brain.cofounder.interview import InterviewTurnRequest, answer_turn
from brain.cofounder.plan import MarketingPlanRequest, make_plan
from brain.cofounder.suggestions import FactSuggestionRequest, suggest_facts
from brain.documents.pdf_text import PdfTextRequest, read_pdf_text
from brain.email.triage import SYSTEM_PROMPT as TRIAGE_SYSTEM_PROMPT
from brain.email.triage import TriageRequest
from brain.email.triage import build_prompt as build_triage_prompt
from brain.email.triage import json_schema as triage_schema
from brain.email.triage import read_answer as read_triage_answer
from brain.menu.reading import JSON_SCHEMA as MENU_JSON_SCHEMA
from brain.menu.reading import SAMPLE_ITEMS, MenuReadRequest, build_content, read_rows
from brain.menu.reading import SYSTEM_PROMPT as MENU_SYSTEM_PROMPT
from brain.posts.autopost import JSON_SCHEMA as POST_JSON_SCHEMA
from brain.posts.autopost import SYSTEM_PROMPT as POST_SYSTEM_PROMPT
from brain.posts.autopost import PostRequest
from brain.posts.autopost import build_prompt as build_post_prompt
from brain.posts.autopost import read_answer as read_post_answer
from brain.security import SIGNATURE_HEADER, TIMESTAMP_HEADER, is_signed_by_core
from brain.settings import Settings, load_settings
from brain.voice.whisper import TranscribeRequest, hear

# The biggest request core sends (one conversation's slice and the company's details).
MAX_BODY_BYTES = 512 * 1024
# A menu to read: a photo or a PDF of up to 4 MB, as base64 (and a practice
# call's recording, up to 2.5 MB).
MENU_BODY_BYTES = 6 * 1024 * 1024
BIG_BODY_PATHS = ("/v1/menu/read", "/v1/documents/pdf-text", "/v1/calls/decide", "/v1/voice/transcribe")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds the app. Tests pass their own settings."""
    active = settings or load_settings()
    app = FastAPI(title="ansa brain", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def only_core(request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        body = await request.body()
        cap = MENU_BODY_BYTES if request.url.path in BIG_BODY_PATHS else MAX_BODY_BYTES
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

    @app.post("/v1/calls/decide")
    def calls_decide(request: CallRequest) -> dict:
        """A finished call: solved (with the customer's own confirming
        sentence) or a person follows up. Never the transcript in a log."""
        return decide_call(request, active_asker, ai.CALL_DECISION)

    @app.post("/v1/documents/pdf-text")
    def documents_pdf_text(request: PdfTextRequest) -> dict:
        """A PDF's text for "Add to knowledge" (never logged)."""
        return read_pdf_text(request)

    @app.post("/v1/posts/write")
    def posts_write(request: PostRequest) -> dict:
        """One "Post for me" post about what core's topic brain chose (core
        checks it before it can go out). Never the post in a log."""
        return write_post(request, asker_for(request.engine, active.development))

    @app.post("/v1/analytics/review")
    def analytics_review(request: ReviewRequest) -> dict:
        """A review of one period's post numbers (core checks every number
        it cites). Never the numbers or the answer in a log."""
        return review_performance(request, active_asker)

    @app.post("/v1/content/draft")
    def content_draft(request: DraftRequest) -> dict:
        """One content studio draft (core cleans it and marks its claims).
        Never the facts or the draft in a log."""
        return write_draft(request, active_asker)

    # The Co-Founder (marketing): core checks every answer before it is saved.
    @app.post("/v1/cofounder/interview-turn")
    def cofounder_interview_turn(request: InterviewTurnRequest) -> dict:
        return answer_turn(request, active_asker)

    @app.post("/v1/cofounder/fact-suggestions")
    def cofounder_fact_suggestions(request: FactSuggestionRequest) -> dict:
        return suggest_facts(request, active_asker)

    @app.post("/v1/cofounder/marketing-plan")
    def cofounder_marketing_plan(request: MarketingPlanRequest) -> dict:
        return make_plan(request, active_asker)

    @app.post("/v1/cofounder/calendar-plan")
    def cofounder_calendar_plan(request: CalendarPlanRequest) -> dict:
        return plan_calendar(request, active_asker)

    @app.post("/v1/voice/transcribe", response_model=None)
    def voice_transcribe(request: TranscribeRequest):
        """DEVELOPMENT ONLY: the practice phone's recording as the caller's
        words, heard by whisper.cpp on this computer (a real phone line hears
        its callers itself). Never the words in a log."""
        if not active.development:
            return Response(status_code=404)
        heard = hear(request)
        if heard.kind != "ok":
            return JSONResponse(status_code=503, content={"error": heard.error_name})
        return {"text": heard.text}

    return app


def write_post(request: PostRequest, asker) -> dict:
    if asker is None:
        return {"kind": "failed", "reason": "model_unavailable"}
    result = asker(POST_SYSTEM_PROMPT, build_post_prompt(request), POST_JSON_SCHEMA, ai.AUTOPOST, request.api_key)
    if result.kind == "unavailable":
        return {"kind": "failed", "reason": "model_unavailable"}
    if result.kind != "ok":
        return {"kind": "failed", "reason": "model_failed", "error_name": result.error_name or result.kind}
    post = read_post_answer(result.output_text)
    return {"kind": "ok", **post} if post is not None else {"kind": "failed", "reason": "unusable_answer"}


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
