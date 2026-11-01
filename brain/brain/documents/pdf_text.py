"""A PDF's text, for "Add to knowledge" (the old lib/knowledge/extract-text.ts
read PDFs with PDF.js; here pypdf, pure Python, no dependencies). Only text:
no pictures, no formatting. A scanned PDF holds pictures of pages, not
text, so nothing can be read from it (no OCR). Core cleans the text and
cuts it into articles; the brain only reads it. Nothing is logged: pypdf's
own warnings can name what is inside the file."""

import base64
import io
import logging

from pydantic import BaseModel, ConfigDict, Field
from pypdf import PdfReader

# pypdf's warnings and errors describe the file's insides: never logged.
logging.getLogger("pypdf").disabled = True

# A hostile PDF can't make the brain read forever: at most this many pages,
# and no more text than core keeps of one import (200,000) with room to spare.
MAX_PAGES = 1_000
MAX_CHARACTERS = 400_000


class PdfTextRequest(BaseModel):
    """The file, base64 (up to 4 MB as core checked)."""

    model_config = ConfigDict(extra="forbid")
    data: str = Field(max_length=6 * 1024 * 1024)


def read_pdf_text(request: PdfTextRequest) -> dict:
    """{"kind": "ok", "text"} or {"kind": "failed", "reason": "unreadable" | "no_text"}."""
    try:
        reader = PdfReader(io.BytesIO(base64.b64decode(request.data, validate=True)))
        parts: list[str] = []
        length = 0
        for index, page in enumerate(reader.pages):
            if index >= MAX_PAGES or length >= MAX_CHARACTERS:
                break
            text = page.extract_text() or ""
            parts.append(text)
            length += len(text)
    except Exception:  # noqa: BLE001 - any damaged or hostile file is just "unreadable"
        return {"kind": "failed", "reason": "unreadable"}
    text = "\n\n".join(parts)[:MAX_CHARACTERS]
    if not text.strip():
        return {"kind": "failed", "reason": "no_text"}
    return {"kind": "ok", "text": text}
