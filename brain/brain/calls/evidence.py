"""The check behind every "solved" (the old lib/call-brain/resolution-evidence.ts).
The model must quote ONE WHOLE sentence in which the customer confirms the
problem is solved, and only a quote that passes every rule counts: equal to
a whole sentence of one of the customer's last two turns (never the 4
opening turns); at least 3 words; not a question (also one that lost its
"?", also after a filler word); not a sentence next to a "..." or a
"[... left out ...]" marker. Case, spacing, quote marks, apostrophes, NFKC
forms and punctuation at the ends are ignored. It can only ever say no to
"solved", never turn anything into it."""

import re
import unicodedata

from brain.calls.transcript import LEFT_OUT_MARKER, Slice

MIN_WORDS = 3
EVIDENCE_TURNS = 2

_CUT_POINTS = re.compile(rf"{LEFT_OUT_MARKER}|\.(?:\s*\.)+")
_POSSIBLE_END = re.compile(r"[.!?]+(?=\s|$)")
_ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "e.g", "i.e"}
_FILLERS = re.compile(r"^((so|and|but|or|okay|ok|alright|well|um|uh|er|ah|oh|hmm|hm|wait|yeah|yes|no|right|sorry|now|then|actually|hey),? )+")
_YES_NO = re.compile(
    r"^(is|are|am|was|were|do|does|did|has|have|had|can|could|will|would|should|shall|isnt|arent|wasnt|werent|dont|doesnt|didnt|hasnt|havent|cant|couldnt|wont|wouldnt|shouldnt) "
    r"(i|you|he|she|it|we|they|that|this|there|the|my|your|our|their|his|her|its|these|those|anyone|anything|everything|someone|something) \S"
)
_WH = re.compile(r"^(what|why|how|when|where|who|which|whose)(s|re|ll| is| are| was| were| do| does| did| has| have| had| can| could| will| would| should) ")
_TAG = re.compile(r", (right|correct|isnt it|didnt it|doesnt it|hasnt it|wasnt it|wont it|arent they|dont you think)$")
_QUOTES = set("'\"`‘’‚‛“”„‟′″‹›«»")


def find_confirmation(evidence: str, piece: Slice) -> str | None:
    """The customer's sentence `evidence` quotes, as the transcript has it, or None."""
    quote = _normalize(evidence)
    if _count_words(quote) < MIN_WORDS or evidence.strip().endswith("?"):
        return None
    customer_turns = [turn.text for turn in piece.closing if turn.speaker == "customer"][-EVIDENCE_TURNS:]
    for text in customer_turns:
        for sentence, has_question_mark, _ in _whole_sentences(text):
            if _normalize(sentence) == quote and not _is_question(sentence, has_question_mark):
                return sentence.strip()
    return None


def _whole_sentences(turn_text: str) -> list[tuple[str, bool, bool]]:
    """(text, has "?", finished). Next to a cut a sentence may be in two
    pieces: the first sentence after a cut, and an unfinished one right
    before it, are left out. An unfinished sentence at the very end counts
    (speech-to-text often drops the last ".")."""
    pieces = _CUT_POINTS.split(unicodedata.normalize("NFKC", turn_text))
    kept = []
    for index, piece in enumerate(pieces):
        sentences = _split(piece)
        if index > 0:
            sentences = sentences[1:]
        if index < len(pieces) - 1 and sentences and not sentences[-1][2]:
            sentences = sentences[:-1]
        kept.extend(sentences)
    return kept


def _split(text: str) -> list[tuple[str, bool, bool]]:
    sentences, start = [], 0
    for match in _POSSIBLE_END.finditer(text):
        end = match.end()
        if not _goes_on(text, match.group(0), end):
            sentences.append((text[start:end], "?" in text[start:end], True))
            start = end
    rest = text[start:]
    if rest.strip():
        sentences.append((rest, "?" in rest, False))
    return sentences


def _goes_on(text: str, punctuation: str, end: int) -> bool:
    """WHY: splitting at every dot would make a "whole sentence" of the end of
    one. It goes on before a small letter or a digit, and after a title or
    short abbreviation ("Dr.", "e.g.")."""
    following = text[end:].lstrip()
    if following and (unicodedata.category(following[0]) == "Ll" or unicodedata.category(following[0]).startswith("N")):
        return True
    if punctuation != ".":
        return False
    start = end - 1
    while start > 0 and (text[start - 1].isalpha() or text[start - 1] == "."):
        start -= 1
    return text[start : end - 1].lower() in _ABBREVIATIONS


def _is_question(sentence: str, has_question_mark: bool) -> bool:
    text = _normalize(sentence)
    without_fillers = _FILLERS.sub("", text)
    return has_question_mark or bool(_YES_NO.match(without_fillers) or _WH.match(without_fillers) or _TAG.search(text))


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = "".join(ch for ch in text if ch not in _QUOTES)
    text = " ".join(text.split())
    return _strip_edges(text)


def _strip_edges(text: str) -> str:
    def edge(ch: str) -> bool:
        return ch.isspace() or unicodedata.category(ch).startswith("P")

    start, end = 0, len(text)
    while start < end and edge(text[start]):
        start += 1
    while end > start and edge(text[end - 1]):
        end -= 1
    return text[start:end]


def _count_words(normalized: str) -> int:
    return sum(1 for word in normalized.split(" ") if any(ch.isalnum() for ch in word))
