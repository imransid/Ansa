"""Text helpers every prompt uses (the same rules as the old backend's
lib/escape-html.ts and lib/redaction.ts): escape a value so it can't close a
tag or pose as an instruction, and hide numbers and addresses the AI doesn't
need."""

import re

_CARD_LIKE = re.compile(r"\b\d(?:[ -]?\d){12,18}\b")
_SSN_LIKE = re.compile(r"\b\d{3}([- ])\d{2}\1\d{4}\b")
# Letters and digits of any script ([^\W_]), as the old \p{L}\p{N} pattern.
_EMAIL = re.compile(r"(?<![^\W_]|[._%+-])(?:[^\W_]|[._%+-])+@(?:[^\W_]|-)+(?:\.(?:[^\W_]|-)+)+")


def escape_html(text: str) -> str:
    """&, <, >, " and ' as entities, & first."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;")


def redact_secret_numbers(text: str) -> str:
    """Card-like and social-security-like numbers become [number]."""
    return _SSN_LIKE.sub("[number]", _CARD_LIKE.sub("[number]", text))


def redact_for_ai(text: str) -> str:
    """A customer's words: secret numbers and email addresses hidden."""
    return _EMAIL.sub("[email]", redact_secret_numbers(text))


def cut(text: str, limit: int) -> str:
    """At most `limit` characters, never splitting a character (Python strings are code points)."""
    return text if len(text) <= limit else text[:limit]
