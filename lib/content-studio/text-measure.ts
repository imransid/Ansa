import { countXCharacters } from "./x-length";

// How a platform counts a text against its limit (step 38). Pure, so the
// editor's live counts in the browser and the approval on the server agree.
//  "x": X's own weighing (x-length.ts).
//  "characters": Unicode characters, as LinkedIn, Facebook and YouTube (for
//    titles) state their limits. An emoji built from several characters (a
//    flag, a skin tone) counts each of them, so a count may run a little
//    high, never low.
//  "utf8-bytes": bytes, as YouTube states a description's limit: a plain
//    letter counts 1, an accented letter 2, most emoji 4.
export type CountingMethod = "x" | "characters" | "utf8-bytes";

// How each count is shown next to its number.
export const COUNTING_UNITS: Record<CountingMethod, string> = {
  x: "characters as X counts them",
  characters: "characters",
  "utf8-bytes": "bytes",
};

const encoder = new TextEncoder();

// The length of `text` counted that way, in its composed form (NFC): an
// accent typed as a separate mark counts with its letter, as the platforms do.
export function measureText(text: string, counting: CountingMethod): number {
  const composed = text.normalize("NFC");
  switch (counting) {
    case "x":
      return countXCharacters(composed);
    case "characters":
      return [...composed].length;
    case "utf8-bytes":
      return encoder.encode(composed).length;
  }
}
