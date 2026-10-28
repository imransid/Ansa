// How long a post is the way X counts it (step 38): X's 280 is not 280
// letters. Its own library (twitter-text, configuration "v3") weighs each
// character: most letters of Latin, Greek, Cyrillic, Hebrew, Arabic and the
// Indic scripts count 1, Chinese, Japanese, Korean and most symbols count
// 2, an emoji counts 2 however many code points it is made of, and every
// link counts 23 whatever its length (X shortens it). The text is compared
// in its composed form (NFC), as X does. Pure, so the editor's live count
// in the browser and the approval on the server agree.
//
// APPROXIMATED, compared with X's own library: which links X shortens
// (here: a word starting with http://, https:// or www.; X also shortens a
// bare domain like "example.com", which counts here letter by letter), and
// which characters make one emoji (here: a grapheme holding a pictographic
// or flag character; a keycap like "1️⃣" or a rare symbol may count a
// little differently). Both err by a few characters at most.

// Code point ranges X counts as one character each.
const ONE_CHARACTER_RANGES: [number, number][] = [
  [0x0000, 0x10ff],
  // Spaces of other widths and the zero-width joiner.
  [0x2000, 0x200d],
  // Dashes and quotation marks.
  [0x2010, 0x201f],
  // Primes.
  [0x2032, 0x2037],
];

// What X counts for any link.
const LINK_LENGTH = 23;
const LINK = /(?:https?:\/\/|www\.)\S+/giu;
// Punctuation right after a link ends the sentence, not the link.
const SENTENCE_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":", ")", "]", "}", "'", '"', "’", "”"]);
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// The length of `text` as X counts it.
export function countXCharacters(text: string): number {
  let count = 0;
  const withoutLinks = text.normalize("NFC").replace(LINK, (link) => {
    count += LINK_LENGTH;
    // The punctuation after the link stays, to be counted as text.
    return trailingPunctuationOf(link);
  });
  for (const { segment } of graphemes.segment(withoutLinks)) {
    count += EMOJI.test(segment) ? 2 : weightOfCharacters(segment);
  }
  return count;
}

// The punctuation a link ends with. WHY a loop from its end, not a regular
// expression like /[.,!?]+$/: that one starts again at every mark of a long
// run that isn't at the end, which takes time growing with the square of
// the run (a link of 63,000 dots took seconds).
function trailingPunctuationOf(link: string): string {
  let start = link.length;
  while (start > 0 && SENTENCE_PUNCTUATION.has(link[start - 1])) {
    start -= 1;
  }
  return link.slice(start);
}

function weightOfCharacters(segment: string): number {
  let weight = 0;
  for (const character of segment) {
    const codePoint = character.codePointAt(0) ?? 0;
    weight += ONE_CHARACTER_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end) ? 1 : 2;
  }
  return weight;
}
