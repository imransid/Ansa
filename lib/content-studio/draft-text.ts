// The texts of a content draft as they are saved (step 38), in ONE place:
// the editor's forms (lib/validation/content-drafts.ts), the AI's answer
// (draft-answer.ts) and the editor's "anything to save?" (editor-values.ts)
// clean them here, so the editor knows what a save would store. Pure.

// Unicode's own bound for text that is safe to work with (UAX #15,
// "Stream-Safe Text Format"): at most 30 combining marks (accents and the
// like) in a row. WHY: counting a text and looking for the words to avoid
// first put its marks in Unicode's order (normalizing), which takes time
// growing with the square of a run's length. One run of 63,000 marks held
// the server for seconds on every check, for every company. Writing never
// comes close to 30.
export const COMBINING_MARKS_MAX_RUN = 30;

// A combining mark, or one of the two half-width sound marks (U+FF9E,
// U+FF9F), which become combining marks when the words to avoid are looked
// for (NFKC).
const MARK = "[\\p{M}\\uFF9E\\uFF9F]";
// A longer run, found at its first mark only (the lookbehind), so the
// search goes over the text once.
const TOO_LONG_RUN = new RegExp(`(?<!${MARK})${MARK}{${COMBINING_MARKS_MAX_RUN + 1}}`, "u");
// A longer run: the marks it may keep, then the rest.
const LONGER_RUN = new RegExp(`(?<!${MARK})(${MARK}{${COMBINING_MARKS_MAX_RUN}})${MARK}+`, "gu");

// Control characters (line breaks, tabs, ...) and the Unicode line and
// paragraph separators, as in lib/plain-text.ts.
const LINE_BREAKING_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
// Invisible format characters (a right-to-left override shows "gpj.exe" as
// "exe.jpg", a zero-width space hides inside a word), except the ones
// writing needs: the zero-width non-joiner (Persian and Hindi spelling),
// the zero-width joiner (emoji such as the woman cook, a woman and a frying
// pan joined) and the tag characters of flags such as Scotland's.
const HIDDEN_FORMAT_CHARACTERS = /(?![\u200C\u200D\u{E0020}-\u{E007F}])\p{Cf}/gu;

// True when the text holds more than COMBINING_MARKS_MAX_RUN marks in a row.
export function hasTooManyMarksInARow(text: string): boolean {
  return TOO_LONG_RUN.test(text);
}

// The text with each run of marks cut to COMBINING_MARKS_MAX_RUN: for what
// the AI writes, which is cleaned rather than refused.
export function cutRunsOfMarks(text: string): string {
  return text.replace(LONGER_RUN, "$1");
}

// One line of a draft (topic, pillar, campaign, a YouTube title, the call
// to action) as it is saved: line breaks become spaces, runs of spaces one,
// nothing blank at the ends, no hidden format characters. As
// toPlainSingleLine (lib/plain-text.ts), but keeping the joiners and tags:
// a title and a call to action are published as written.
export function cleanDraftLine(text: string): string {
  return text.replace(LINE_BREAKING_CHARACTERS, " ").replace(HIDDEN_FORMAT_CHARACTERS, "").replace(/\s+/g, " ").trim();
}

// Several lines of a draft (the text, the image description, the video
// script, a rejection note) as saved: line breaks as \n (a form sends \r\n,
// which the box counted as one), nothing blank at the ends.
export function cleanDraftLines(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}
