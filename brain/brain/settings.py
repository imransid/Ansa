"""The brain's settings, read once at start. A missing or short secret stops
the service with a message naming the setting, never its value."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    shared_secret: str
    # Development allows the Claude Code engine; production never does.
    development: bool = False


def load_settings() -> Settings:
    secret = os.environ.get("BRAIN_SHARED_SECRET", "")
    if len(secret) < 32:
        raise SystemExit("settings: BRAIN_SHARED_SECRET must be at least 32 characters (the same as core's)")
    environment = os.environ.get("ANSA_ENV", "production")
    if environment not in ("development", "production"):
        raise SystemExit('settings: ANSA_ENV must be "development" or "production"')
    return Settings(shared_secret=secret, development=environment == "development")
