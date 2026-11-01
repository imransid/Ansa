"""What the AI reads of an email body (the old lib/email-triage/own-text.ts):
only what the customer wrote this time. Quoted earlier messages, forwarded
messages and the signature are cut first, so other people's names and old
messages never reach the model. The request keeps the whole email.

Every pattern is only what mail programs really write: a customer's own
text that merely looks like it ("From: London / Date: 20 October") must reach
the model, because its summary and category are made from it."""

import re

ATTRIBUTION_START = re.compile(r"^(On|Am|Le|El|Op|Em|Il)\s")
ATTRIBUTION_VERB = re.compile(r"(?<![^\W\d_])(wrote|schrieb|écrit|escribió|schreef|escreveu|scritto)(?![^\W\d_])", re.IGNORECASE)
ATTRIBUTION_DETAIL = re.compile(r"[@<]|\d{1,2}:\d{2}")
MAX_ATTRIBUTION_LINES = 3
MAX_ATTRIBUTION_CHARACTERS = 300

HEADER_FROM = re.compile(r"^\*?(From|De|Von|Van|Da)\s?:", re.IGNORECASE)
HEADER_SENT = re.compile(r"^\*?(Sent|Date|Gesendet|Datum|Envoyé|Enviado|Enviada em|Verzonden|Inviato|Data)\s?:", re.IGNORECASE)
HEADER_SUBJECT = re.compile(r"^\*?(Subject|Betreff|Objet|Asunto|Assunto|Onderwerp|Oggetto)\s?:", re.IGNORECASE)
HEADER_LOOKAHEAD_LINES = 5

SEPARATOR_DASHES = "-----"
MAX_SEPARATOR_CHARACTERS = 200
SEPARATOR_WORDS = re.compile(r"original|origine|forward|weitergeleitet|ursprünglich|transféré|reenviado|encaminhad|oorspronkelijk|doorgestuurd|inoltrato", re.IGNORECASE)
APPLE_FORWARD_LINE = re.compile(r"^Begin forwarded message:?$", re.IGNORECASE)

# RFC 3676's signature line: exactly "-- ", the space included.
SIGNATURE_DELIMITER = "-- "
BLANK_OR_RULE_LINE = re.compile(r"^[\s_=*~-]*$")
LETTER_OR_DIGIT = re.compile(r"[^\W_]")
LETTER = re.compile(r"[^\W\d_]")


def keep_own_text(body: str) -> tuple[str, bool]:
    """The customer's own words, and whether an earlier or forwarded message was cut.
    When nothing they wrote comes before such a cut (a bare forward), nothing is cut."""
    lines = re.split(r"\r\n|\r|\n", body)
    kept: list[str] = []
    wrote_something = False
    removed = False
    index = 0
    while index < len(lines):
        attribution = count_attribution_lines(lines, index)
        if attribution > 0 and is_quoted(next_text_line(lines, index + attribution)):
            removed = True
            index += attribution
            continue
        starts_earlier = attribution > 0 or starts_earlier_message(lines, index)
        if starts_earlier and wrote_something:
            return finish(kept), True
        if is_quoted(lines[index]):
            removed = True
            index += 1
            continue
        kept.append(lines[index])
        if not starts_earlier:
            wrote_something = wrote_something or bool(LETTER_OR_DIGIT.search(lines[index]))
        index += 1
    return finish(kept), removed


def count_attribution_lines(lines: list[str], index: int) -> int:
    if not ATTRIBUTION_START.match(lines[index].strip()):
        return 0
    joined = ""
    for count in range(1, MAX_ATTRIBUTION_LINES + 1):
        if index + count > len(lines):
            break
        joined = f"{joined} {lines[index + count - 1].strip()}".strip()
        if len(joined) > MAX_ATTRIBUTION_CHARACTERS:
            return 0
        if joined.endswith(":") and ATTRIBUTION_VERB.search(joined) and ATTRIBUTION_DETAIL.search(joined):
            return count
    return 0


def next_text_line(lines: list[str], start: int) -> str:
    for line in lines[start:]:
        if line.strip():
            return line.strip()
    return ""


def starts_earlier_message(lines: list[str], index: int) -> bool:
    line = lines[index].strip()
    return is_separator(lines, index) or bool(APPLE_FORWARD_LINE.match(line)) or is_outlook_header(lines, index)


def is_separator(lines: list[str], index: int) -> bool:
    line = lines[index].strip()
    dashed = len(line) <= MAX_SEPARATOR_CHARACTERS and line.startswith(SEPARATOR_DASHES) and line.endswith(SEPARATOR_DASHES) and bool(LETTER.search(line))
    return dashed and (bool(SEPARATOR_WORDS.search(line)) or bool(HEADER_FROM.match(next_text_line(lines, index + 1))))


def is_outlook_header(lines: list[str], index: int) -> bool:
    if not HEADER_FROM.match(lines[index].strip()):
        return False
    following = [line.strip() for line in lines[index + 1 : index + 1 + HEADER_LOOKAHEAD_LINES]]
    return any(HEADER_SENT.match(line) for line in following) and any(HEADER_SUBJECT.match(line) for line in following)


def is_quoted(line: str) -> bool:
    return line.lstrip().startswith(">")


def finish(kept: list[str]) -> str:
    """Drops the signature (from the last "-- " line on) and empty or rule lines at the end."""
    if SIGNATURE_DELIMITER in kept:
        last = len(kept) - 1 - kept[::-1].index(SIGNATURE_DELIMITER)
        kept = kept[:last]
    while kept and BLANK_OR_RULE_LINE.match(kept[-1]):
        kept.pop()
    return "\n".join(kept).strip()
