// Turns a full call transcript into the smaller, cleaned-up slice that is the
// ONLY part of a call ever sent to Claude (Rule: never send more than needed).
//
// We keep the opening turns (what the customer wanted) and the closing turns
// (how it ended), because those decide "solved or not". The middle is dropped
// and replaced by a count.

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
// With MAX_TURN_CHARACTERS, the shrinking loop below always gets under this:
// 4 opening turns + 1 closing turn = 7,500 characters at most.
const MAX_SLICE_CHARACTERS = 8_000;
const MAX_TURN_CHARACTERS = 1_500;

// Vapi labels each line "AI:" or "User:". Other labels are accepted just in case.
const SPEAKER_LABEL = /(^|\s)(AI|Assistant|Agent|Bot|User|Customer):/g;
const CUSTOMER_LABELS = new Set(["User", "Customer"]);

// Payment-card-like numbers: 13 to 19 digits, optionally split by spaces or dashes.
const CARD_LIKE_NUMBER = /\b\d(?:[ -]?\d){12,18}\b/g;

// Builds the slice that gets sent to Claude.
export function buildTranscriptSlice(transcript: string): TranscriptSlice {
  const turns = parseTranscriptTurns(transcript).map(cleanTurn);
  const opening = turns.slice(0, OPENING_TURNS);
  const closing = turns.slice(Math.max(OPENING_TURNS, turns.length - CLOSING_TURNS));

  // Too long: drop the oldest closing turns first. The opening (the problem)
  // and the very last turns (the outcome) matter most.
  while (totalCharacters(opening, closing) > MAX_SLICE_CHARACTERS && closing.length > 1) {
    closing.shift();
  }

  return {
    opening,
    closing,
    omittedTurnCount: turns.length - opening.length - closing.length,
    customerTurnCount: turns.filter((turn) => turn.speaker === "customer").length,
  };
}

// Splits "AI: Hello User: Hi ..." (one line or many) into speaker turns.
export function parseTranscriptTurns(transcript: string): TranscriptTurn[] {
  const labels = [...transcript.matchAll(SPEAKER_LABEL)];
  if (labels.length === 0) {
    const text = transcript.trim();
    return text ? [{ speaker: "unknown", text }] : [];
  }

  const turns: TranscriptTurn[] = [];
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    const textStart = label.index + label[0].length;
    const textEnd = index + 1 < labels.length ? labels[index + 1].index : transcript.length;
    const text = transcript.slice(textStart, textEnd).trim();
    if (text) {
      turns.push({ speaker: CUSTOMER_LABELS.has(label[2]) ? "customer" : "agent", text });
    }
  }
  return turns;
}

// Redacts card-like numbers, removes angle brackets (so the text can't close
// our <transcript> tag), and caps very long turns.
function cleanTurn(turn: TranscriptTurn): TranscriptTurn {
  const text = turn.text
    .replace(CARD_LIKE_NUMBER, "[number]")
    .replaceAll("<", "(")
    .replaceAll(">", ")")
    .slice(0, MAX_TURN_CHARACTERS);
  return { speaker: turn.speaker, text };
}

function totalCharacters(...turnLists: TranscriptTurn[][]): number {
  return turnLists.flat().reduce((sum, turn) => sum + turn.text.length, 0);
}
