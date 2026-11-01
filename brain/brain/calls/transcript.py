"""The slice of a finished call that is the ONLY part ever sent to the model
(the old lib/call-brain/transcript-slice.ts): the opening turns (what the
customer wanted) and the closing turns (how it ended), the middle replaced by
a count. A very long turn keeps its start and its end, with a marker for
what was left out. Card-like and social-security-like numbers and email
addresses are hidden before any cut."""

import re
from dataclasses import dataclass, field

from brain.text import redact_for_ai

OPENING_TURNS = 4
CLOSING_TURNS = 16
# The end of the call decides "solved or not": the last two turns are never
# dropped, and a long turn always keeps its end.
LAST_TURNS_ALWAYS_KEPT = 2
MAX_SLICE_CHARACTERS = 8_000
MAX_TURN_CHARACTERS = 1_300
KEPT_START = 600
KEPT_END = 600

LEFT_OUT_MARKER = r"\[\.\.\. \d+ characters left out \.\.\.\]"

# Vapi labels each line "AI:" or "User:"; other labels are accepted just in case.
_LABELS = "AI|Assistant|Agent|Bot|User|Customer"
_LINE_START_LABEL = re.compile(rf"^[ \t]*({_LABELS}):", re.MULTILINE)
_ANY_LABEL = re.compile(rf"(?:^|\s)({_LABELS}):")
_CUSTOMER_LABELS = {"User", "Customer"}


@dataclass
class Turn:
    speaker: str  # "customer", "agent" or "unknown"
    text: str


@dataclass
class Slice:
    opening: list[Turn] = field(default_factory=list)
    closing: list[Turn] = field(default_factory=list)
    omitted_turns: int = 0
    # Counted over the whole transcript, not just the slice.
    customer_turns: int = 0


def build_slice(transcript: str) -> Slice:
    turns = [_clean(turn) for turn in parse_turns(transcript)]
    opening = turns[:OPENING_TURNS]
    closing = turns[max(OPENING_TURNS, len(turns) - CLOSING_TURNS) :]
    # Too long: drop the oldest closing turns first.
    while _length(opening + closing) > MAX_SLICE_CHARACTERS and len(closing) > LAST_TURNS_ALWAYS_KEPT:
        closing.pop(0)
    return Slice(opening, closing, len(turns) - len(opening) - len(closing), sum(1 for turn in turns if turn.speaker == "customer"))


def parse_turns(transcript: str) -> list[Turn]:
    """Speaker turns: one per line like Vapi's ("AI: Hello\\nUser: Hi"), or
    all on one line. WHY only line-start labels when there are such lines:
    "Customer:" in the middle of a line is something someone SAID."""
    at_line_start = list(_LINE_START_LABEL.finditer(transcript))
    labels = at_line_start if len(at_line_start) >= 2 else list(_ANY_LABEL.finditer(transcript))
    if not labels:
        text = transcript.strip()
        return [Turn("unknown", text)] if text else []
    turns = []
    for index, label in enumerate(labels):
        end = labels[index + 1].start() if index + 1 < len(labels) else len(transcript)
        text = transcript[label.end() : end].strip()
        if text:
            turns.append(Turn("customer" if label.group(1) in _CUSTOMER_LABELS else "agent", text))
    return turns


def _clean(turn: Turn) -> Turn:
    """One line per turn, secrets hidden, angle brackets replaced (nothing
    can close our tag), a long turn shortened (after hiding: a cut can't
    leave half a card number)."""
    one_line = " ".join(turn.text.split())
    text = redact_for_ai(one_line).replace("<", "(").replace(">", ")")
    return Turn(turn.speaker, _shorten(text))


def _shorten(text: str) -> str:
    if len(text) <= MAX_TURN_CHARACTERS:
        return text
    start = _keep_start(text, KEPT_START)
    end = _keep_end(text, KEPT_END)
    return f"{start} [... {len(text) - len(start) - len(end)} characters left out ...] {end}"


def _keep_start(text: str, length: int) -> str:
    last_space = text.rfind(" ", 0, length + 1)
    cut = last_space if last_space > length / 2 else length
    return text[:cut].rstrip()


def _keep_end(text: str, length: int) -> str:
    earliest = len(text) - length
    space = text.find(" ", earliest - 1)
    cut = space + 1 if space != -1 and space < earliest + length / 2 else earliest
    return text[cut:].lstrip()


def _length(turns: list[Turn]) -> int:
    return sum(len(turn.text) for turn in turns)


def to_prompt(piece: Slice, categories: list[str]) -> str:
    """The user message: the slice and the company's category names (one per
    line; names can't hold < or >). No company name or ids."""
    names = {"customer": "Customer", "agent": "Agent", "unknown": "Unknown"}
    lines = [f"{names[turn.speaker]}: {turn.text}" for turn in piece.opening]
    if piece.omitted_turns > 0:
        lines.append(f"[{piece.omitted_turns} turns left out]")
    lines.extend(f"{names[turn.speaker]}: {turn.text}" for turn in piece.closing)
    category_lines = "\n".join(f"- {name}" for name in categories)
    return "<transcript>\n" + "\n".join(lines) + "\n</transcript>\n\n<categories>\n" + category_lines + "\n</categories>"
