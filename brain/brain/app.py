"""The brain's web service. It listens only on a private address (127.0.0.1
in development), accepts only requests core signed, keeps no state between
requests and never touches the database.

Run: BRAIN_SHARED_SECRET=... .venv/bin/uvicorn brain.app:create_app --factory --host 127.0.0.1 --port 8090
"""

from fastapi import FastAPI, Request, Response

from brain.security import SIGNATURE_HEADER, TIMESTAMP_HEADER, is_signed_by_core
from brain.settings import Settings, load_settings

# The biggest request core sends (one conversation's slice and the company's details).
MAX_BODY_BYTES = 512 * 1024


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds the app. Tests pass their own settings."""
    active = settings or load_settings()
    app = FastAPI(title="ansa brain", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def only_core(request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
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

    return app
