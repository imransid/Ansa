import { WORD_TO_AVOID_MAX_LENGTH, WORDS_TO_AVOID_MAX } from "./limits";

// The "Words to avoid" fact of the business profile (step 36) as the
// content rules read it (step 38): the words and phrases no draft may use.
// The fact is free text an owner typed, so it is split where a list would
// be: line breaks, commas and semicolons ("cheap, discount; best in town").
// Each piece loses a list marker ("- ", "1. "), its quotes and the
// punctuation at its end. A whole sentence stays one phrase, which a post
// rarely repeats word for word: the studio shows every phrase it looks
// for, so an owner sees exactly what is checked. Pure.

// A fact that only says there are none ("None.", "n/a"). English only.
const SAYS_NONE = new Set(["none", "no", "nothing", "n/a", "na", "not really", "nothing specific", "no restrictions"]);

// The words and phrases to look for, from the confirmed fact (null: none
// confirmed), each once, at most WORDS_TO_AVOID_MAX.
export function readWordsToAvoid(fact: string | null): string[] {
  if (!fact || SAYS_NONE.has(cleanTerm(fact.normalize("NFKC")).toLowerCase())) {
    return [];
  }
  const terms: string[] = [];
  for (const piece of fact.normalize("NFKC").split(/[\n,;]+/u)) {
    const term = cleanTerm(piece);
    const length = [...term].length;
    const isNew = !terms.some((existing) => existing.toLowerCase() === term.toLowerCase());
    if (length >= 2 && length <= WORD_TO_AVOID_MAX_LENGTH && isNew) {
      terms.push(term);
    }
  }
  return terms.slice(0, WORDS_TO_AVOID_MAX);
}

// The words to avoid that `text` uses, each found as a whole word or phrase
// in any case: "cheap" finds "Cheap!" and "#cheap", never "cheapest". WHY
// whole words: a match blocks approval, and a word that merely contains
// another is often fine ("free" in "carefree"). The text is normalized once
// per call: pass all the terms at once.
export function findWordsToAvoid(text: string, terms: readonly string[]): string[] {
  const normalized = text.normalize("NFKC");
  return terms.filter((term) => wholeWordPattern(term).test(normalized));
}

// The term with any run of spaces matching any run of spaces, and no
// letter, mark or digit right before or after it.
function wholeWordPattern(term: string): RegExp {
  const words = term.split(/\s+/u).map(escapeRegExp).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${words}(?![\\p{L}\\p{M}\\p{N}])`, "iu");
}

function cleanTerm(piece: string): string {
  return piece
    .trim()
    .replace(/^(?:[-*•–—]|\d+[.)])\s*/u, "")
    .replace(/^["'“”‘’«»„]+/u, "")
    .replace(/["'“”‘’«»„.!?:]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

// Only the characters a regular expression reads as syntax (with the "u"
// flag, escaping any other character is itself an error).
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
