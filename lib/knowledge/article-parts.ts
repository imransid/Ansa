import { toPlainSingleLine } from "@/lib/plain-text";
import { packParagraphs } from "./chunking";
import { KNOWLEDGE_BODY_MAX_LENGTH, KNOWLEDGE_TITLE_MAX_LENGTH, MAX_IMPORTED_CHARACTERS } from "./limits";

// Turns the text of an imported document or web page into draft articles
// (step 34): at most 200,000 characters, cut into articles of at most 20,000
// at paragraph boundaries, titled "<name>" or "<name> (part 2 of 3)". Pure.

export type ArticlePart = { title: string; body: string };

export type ImportedParts = {
  parts: ArticlePart[];
  // The text was longer than 200,000 characters and its end was left out.
  wasCut: boolean;
};

// What a part is called when the file or page has no usable name.
const UNNAMED_SOURCE = "Imported text";

// The articles one imported text becomes. Empty text gives no parts.
export function splitImportedText(text: string, sourceName: string): ImportedParts {
  const wasCut = text.length > MAX_IMPORTED_CHARACTERS;
  const kept = wasCut ? cutBeforeLastSpace(text, MAX_IMPORTED_CHARACTERS) : text;
  const bodies = packParagraphs(kept, KNOWLEDGE_BODY_MAX_LENGTH);
  const name = toPlainSingleLine(sourceName) || UNNAMED_SOURCE;
  const parts = bodies.map((body, index) => ({ title: partTitle(name, index + 1, bodies.length), body }));
  return { parts, wasCut };
}

// "Returns policy.pdf", or "Returns policy.pdf (part 2 of 3)". A long name is
// cut so the whole title fits in 200 characters.
function partTitle(name: string, partNumber: number, partCount: number): string {
  const suffix = partCount > 1 ? ` (part ${partNumber} of ${partCount})` : "";
  return `${cutToLength(name, KNOWLEDGE_TITLE_MAX_LENGTH - suffix.length)}${suffix}`;
}

// The first maxLength characters, ending before the last space in them, so
// the cut never leaves half a word (unless there is no space at all).
function cutBeforeLastSpace(text: string, maxLength: number): string {
  const cut = cutToLength(text, maxLength);
  for (let index = cut.length - 1; index > 0; index--) {
    if (/\s/.test(cut[index])) {
      return cut.slice(0, index).trimEnd();
    }
  }
  return cut;
}

// At most maxLength characters, never splitting an emoji into two halves.
function cutToLength(text: string, maxLength: number): string {
  const cut = text.slice(0, maxLength);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1).trimEnd() : cut.trimEnd();
}
