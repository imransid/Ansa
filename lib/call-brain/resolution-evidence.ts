import { LEFT_OUT_MARKER, type TranscriptSlice } from "./transcript-slice";

// The check behind every "solved" (step 28). Claude must quote ONE WHOLE
// sentence in which the customer confirms the problem is solved, and only a
// quote that passes every rule below counts:
// - it equals a whole sentence of one of the customer's last two turns, not
//   a piece of one ("it's working now" from "I don't think it's working now"
//   does not count). Case, spacing, quote marks, apostrophes and punctuation
//   at the ends are ignored; everything else must match;
// - never from the opening turns: those describe the problem ("your reset
//   fixed it last time"), not how the call ended;
// - at least 3 words ("Thank you" proves nothing);
// - not a question ("Has that fixed it?", also without its "?", also after a
//   word like "So" or "Okay,": "Okay, is it fixed now");
// - not a sentence a "[... left out ...]" marker or a "..." cut: the rest of
//   it is unknown ("I don't think... it's working now").
// This can only ever say no to "solved", never turn anything into it.

const MIN_EVIDENCE_WORDS = 3;
const EVIDENCE_TURNS = 2;

// Where a sentence may be cut in two: the marker of a shortened turn, or an
// ellipsis, which speech-to-text writes for a pause in the middle of a
// sentence. An ellipsis is two or more dots, also spaced ("…" is "..." after NFKC).
const ELLIPSIS = /\.(?:\s*\.)+/;
const CUT_POINTS = new RegExp(`${LEFT_OUT_MARKER.source}|${ELLIPSIS.source}`);

// ".", "!" or "?" followed by a space or the end: where a sentence may end.
const POSSIBLE_SENTENCE_END = /[.!?]+(?=\s|$)/g;
// Short words with a dot after which the sentence goes on: "Dr. Lee's fix".
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "e.g", "i.e"]);

// Words a spoken question often starts with ("So is it working now", "Okay,
// did that fix it"). They are skipped before the question patterns below.
const LEADING_FILLER_WORDS =
  /^((so|and|but|or|okay|ok|alright|well|um|uh|er|ah|oh|hmm|hm|wait|yeah|yes|no|right|sorry|now|then|actually|hey),? )+/;
// Speech-to-text often drops a question's "?", so a sentence that starts
// like a question counts as one: "has that fixed it", "is it working now".
const YES_NO_QUESTION =
  /^(is|are|am|was|were|do|does|did|has|have|had|can|could|will|would|should|shall|isnt|arent|wasnt|werent|dont|doesnt|didnt|hasnt|havent|cant|couldnt|wont|wouldnt|shouldnt) (i|you|he|she|it|we|they|that|this|there|the|my|your|our|their|his|her|its|these|those|anyone|anything|everything|someone|something) \S/;
// "what did you change", "hows it going" (apostrophes are already removed).
const WH_QUESTION = /^(what|why|how|when|where|who|which|whose)(s|re|ll| is| are| was| were| do| does| did| has| have| had| can| could| will| would| should) /;
// "that fixed it, right"
const TAG_QUESTION = /, (right|correct|isnt it|didnt it|doesnt it|hasnt it|wasnt it|wont it|arent they|dont you think)$/;

// Straight and curly quote marks and apostrophes, after NFKC.
const QUOTE_MARKS = /['"`‘’‚‛“”„‟′″‹›«»]/g;
const EDGE_PUNCTUATION = /^[\p{P}\s]+|[\p{P}\s]+$/gu;

// isFinished is false for the words after the last sentence end of a text.
type Sentence = { text: string; hasQuestionMark: boolean; isFinished: boolean };

// True when `evidence` is a customer's confirming sentence by the rules above.
export function isCustomerConfirmation(evidence: string, slice: TranscriptSlice): boolean {
  return findCustomerConfirmation(evidence, slice) !== null;
}

// The customer's sentence that `evidence` quotes by the rules above, as the
// transcript has it (step 31: stored with the "solved", shown on the call
// page), or null when it quotes no such sentence.
export function findCustomerConfirmation(evidence: string, slice: TranscriptSlice): string | null {
  const quote = normalize(evidence);
  if (countWords(quote) < MIN_EVIDENCE_WORDS || evidence.trim().endsWith("?")) {
    return null;
  }
  for (const turnText of lastCustomerTurnTexts(slice)) {
    const match = wholeSentences(turnText).find((sentence) => normalize(sentence.text) === quote && !isQuestion(sentence));
    if (match) {
      return match.text.trim();
    }
  }
  return null;
}

// The customer's last two turns, from the closing turns only.
function lastCustomerTurnTexts(slice: TranscriptSlice): string[] {
  const customerTurns = slice.closing.filter((turn) => turn.speaker === "customer");
  return customerTurns.slice(-EVIDENCE_TURNS).map((turn) => turn.text);
}

// The whole sentences of one turn. Next to a cut (a marker or "...") a
// sentence may be in two pieces, so the first sentence after a cut, and an
// unfinished one right before it, are left out. An unfinished sentence at the
// very end of the turn counts: speech-to-text often drops the last ".".
function wholeSentences(turnText: string): Sentence[] {
  const pieces = turnText.normalize("NFKC").split(CUT_POINTS);
  return pieces.flatMap((piece, index) => {
    let sentences = splitIntoSentences(piece);
    if (index > 0) {
      sentences = sentences.slice(1);
    }
    const isLastPiece = index === pieces.length - 1;
    if (!isLastPiece && sentences.at(-1)?.isFinished === false) {
      sentences = sentences.slice(0, -1);
    }
    return sentences;
  });
}

// Splits after ".", "!" or "?" followed by a space or the end, except where
// the sentence goes on (see sentenceGoesOn). "12.50" has no space after its
// dot, so it never ends a sentence.
function splitIntoSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  for (const match of text.matchAll(POSSIBLE_SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (!sentenceGoesOn(text, match[0], end)) {
      sentences.push(toSentence(text.slice(start, end), true));
      start = end;
    }
  }
  const rest = text.slice(start);
  if (rest.trim() !== "") {
    sentences.push(toSentence(rest, false));
  }
  return sentences;
}

// WHY: splitting at every dot would make a "whole sentence" of the end of
// one ("Lee's fix is working now." from "I don't think Dr. Lee's fix is
// working now."). The sentence goes on before a word that starts with a
// small letter or a digit ("e.g. the router", "order no. 5"), and after a
// dot that ends a title or short abbreviation ("Dr.", "e.g.").
function sentenceGoesOn(text: string, punctuation: string, end: number): boolean {
  if (/[\p{Ll}\p{N}]/u.test(nextVisibleCharacter(text, end))) {
    return true;
  }
  return punctuation === "." && ABBREVIATIONS.has(wordBefore(text, end - 1));
}

// The first character from `position` on that isn't a space, or "" at the end.
function nextVisibleCharacter(text: string, position: number): string {
  let index = position;
  while (index < text.length && /\s/.test(text[index])) {
    index++;
  }
  return text.charAt(index);
}

// The word right before `position`, lowercased: "dr" for "Dr.", "e.g" for "e.g.".
function wordBefore(text: string, position: number): string {
  let start = position;
  while (start > 0 && /[\p{L}.]/u.test(text[start - 1])) {
    start--;
  }
  return text.slice(start, position).toLowerCase();
}

function toSentence(text: string, isFinished: boolean): Sentence {
  return { text, hasQuestionMark: text.includes("?"), isFinished };
}

function isQuestion(sentence: Sentence): boolean {
  const text = normalize(sentence.text);
  const withoutFillers = text.replace(LEADING_FILLER_WORDS, "");
  return sentence.hasQuestionMark || YES_NO_QUESTION.test(withoutFillers) || WH_QUESTION.test(withoutFillers) || TAG_QUESTION.test(text);
}

// Ignores width and look-alike forms (NFKC), case, quote marks and
// apostrophes, extra spaces, and punctuation at either end.
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(QUOTE_MARKS, "").replace(/\s+/g, " ").replace(EDGE_PUNCTUATION, "");
}

function countWords(normalizedText: string): number {
  return normalizedText.split(" ").filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
