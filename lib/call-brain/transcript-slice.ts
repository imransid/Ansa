// Turns a full call transcript into the smaller, cleaned-up slice that is the
// ONLY part of a call ever sent to Claude (Rule: never send more than needed).
//
// We keep the opening turns (what the customer wanted) and the closing turns
// (how it ended), because those decide "solved or not". The middle is dropped
// and replaced by a count. A very long turn keeps its start and its end, with
// a marker saying how much of its middle was left out.

import { redactForClaude } from "@/lib/redaction";

export type Speaker = "customer" | "agent" | "unknown";

export type TranscriptTurn = {
  speaker: Speaker;
  text: string;
};

export type TranscriptSlice = {
  opening: TranscriptTurn[];
  closing: TranscriptTurn[];
  omittedTurnCount: number;
  // Counted over the whole transcript, not just the slice.
  customerTurnCount: number;
};

const OPENING_TURNS = 4;
const CLOSING_TURNS = 16;
// The end of the call decides "solved or not": the last two turns are never
// dropped, and a long turn always keeps its end.
const LAST_TURNS_ALWAYS_KEPT = 2;
// With MAX_TURN_CHARACTERS, the shrinking loop below always gets under this:
// 4 opening turns + the last 2 turns = 7,800 characters at most.
const MAX_SLICE_CHARACTERS = 8_000;
// lib/call-brain/model-output.ts caps Claude's quoted evidence at this too.
export const MAX_TURN_CHARACTERS = 1_300;
// What a longer turn keeps of its start and of its end (plus the marker).
const KEPT_START_CHARACTERS = 600;
const KEPT_END_CHARACTERS = 600;

// Marks the middle of a long turn that was left out. lib/call-brain/
// resolution-evidence.ts reads it too: a sentence it cut is never evidence.
export const LEFT_OUT_MARKER = /\[\.\.\. \d+ characters left out \.\.\.\]/;

// Vapi labels each line "AI:" or "User:". Other labels are accepted just in case.
const LABEL_NAMES = "AI|Assistant|Agent|Bot|User|Customer";
// A label at the start of a line (spaces before it are fine).
const LINE_START_LABEL = new RegExp(`^[ \\t]*(${LABEL_NAMES}):`, "gm");
// A label anywhere after a space, for a transcript that comes as one line.
const ANY_LABEL = new RegExp(`(?:^|\\s)(${LABEL_NAMES}):`, "g");
const CUSTOMER_LABELS = new Set(["User", "Customer"]);

// Builds the slice that gets sent to Claude.
export function buildTranscriptSlice(transcript: string): TranscriptSlice {
  const turns = parseTranscriptTurns(transcript).map(cleanTurn);
  const opening = turns.slice(0, OPENING_TURNS);
  const closing = turns.slice(Math.max(OPENING_TURNS, turns.length - CLOSING_TURNS));

  // Too long: drop the oldest closing turns first. The opening (the problem)
  // and the very last turns (the outcome) matter most.
  while (totalCharacters(opening, closing) > MAX_SLICE_CHARACTERS && closing.length > LAST_TURNS_ALWAYS_KEPT) {
    closing.shift();
  }

  return {
    opening,
    closing,
    omittedTurnCount: turns.length - opening.length - closing.length,
    customerTurnCount: turns.filter((turn) => turn.speaker === "customer").length,
  };
}

// Splits a transcript into speaker turns: "AI: Hello\nUser: Hi" (one turn
// per line, like Vapi's), or "AI: Hello User: Hi" (all on one line).
export function parseTranscriptTurns(transcript: string): TranscriptTurn[] {
  const labels = findSpeakerLabels(transcript);
  if (labels.length === 0) {
    const text = transcript.trim();
    return text ? [{ speaker: "unknown", text }] : [];
  }

  const turns: TranscriptTurn[] = [];
  for (let index = 0; index < labels.length; index++) {
    const textEnd = index + 1 < labels.length ? labels[index + 1].start : transcript.length;
    const text = transcript.slice(labels[index].end, textEnd).trim();
    if (text) {
      turns.push({ speaker: CUSTOMER_LABELS.has(labels[index].name) ? "customer" : "agent", text });
    }
  }
  return turns;
}

// Where each turn's label is. WHY only labels at the start of a line when the
// transcript has one turn per line: there, "Customer:" in the middle of a
// line is something someone SAID (the agent reading out a note), not a new
// speaker, and must never become a customer turn.
function findSpeakerLabels(transcript: string) {
  const atLineStart = [...transcript.matchAll(LINE_START_LABEL)];
  const matches = atLineStart.length >= 2 ? atLineStart : [...transcript.matchAll(ANY_LABEL)];
  return matches.map((match) => ({ start: match.index, end: match.index + match[0].length, name: match[1] }));
}

// One line per turn (so nothing in a turn can look like a new turn to
// Claude), sensitive numbers and email addresses redacted, angle brackets
// removed (so the text can't close our <transcript> tag), and a long turn
// shortened. Redacting comes first, so a cut can't leave half a card number.
function cleanTurn(turn: TranscriptTurn): TranscriptTurn {
  const oneLine = turn.text.replace(/\s+/g, " ").trim();
  const text = redactForClaude(oneLine).replaceAll("<", "(").replaceAll(">", ")");
  return { speaker: turn.speaker, text: shortenLongTurn(text) };
}

// A turn over MAX_TURN_CHARACTERS keeps its start and its end, cut between
// words, with a marker for the middle. The end matters most at the end of a
// call: "Oh wait, no, it is NOT fixed" must reach Claude.
function shortenLongTurn(text: string): string {
  if (text.length <= MAX_TURN_CHARACTERS) {
    return text;
  }
  const start = keepStart(text, KEPT_START_CHARACTERS);
  const end = keepEnd(text, KEPT_END_CHARACTERS);
  const leftOut = text.length - start.length - end.length;
  return `${start} [... ${leftOut} characters left out ...] ${end}`;
}

// At most `length` characters from the start, ending at the end of a word.
function keepStart(text: string, length: number): string {
  const lastSpace = text.lastIndexOf(" ", length);
  const cut = lastSpace > length / 2 ? lastSpace : length;
  return text.slice(0, cut).trimEnd();
}

// At most `length` characters from the end, starting at the start of a word.
function keepEnd(text: string, length: number): string {
  const earliestStart = text.length - length;
  const space = text.indexOf(" ", earliestStart - 1);
  const cut = space !== -1 && space < earliestStart + length / 2 ? space + 1 : earliestStart;
  return text.slice(cut).trimStart();
}

function totalCharacters(...turnLists: TranscriptTurn[][]): number {
  return turnLists.flat().reduce((sum, turn) => sum + turn.text.length, 0);
}
