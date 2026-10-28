import { cutRunsOfMarks } from "./draft-text";
import { DRAFT_HASHTAGS_MAX, HASHTAG_MAX_LENGTH } from "./limits";

// A draft's hashtags (step 38): stored without their "#", one word each,
// shown and published as "#bread #lisbon". Pure, so the editor in the
// browser reads its box exactly as the server does.

// Letters of any script with their marks, digits and "_", but not digits
// alone: what the platforms turn into a link. Anything else (a hyphen, a
// dot, an invisible character) would end the hashtag where the reader
// doesn't expect it.
const HASHTAG = /^[\p{L}\p{M}\p{N}_]+$/u;
const DIGITS_ONLY = /^\p{N}+$/u;

export type TypedHashtags = {
  hashtags: string[];
  // What was typed that can't be a hashtag, as typed ("#café-bar").
  invalid: string[];
};

// True for one word that works as a hashtag (without its "#").
export function isValidHashtag(tag: string): boolean {
  return tag.length <= HASHTAG_MAX_LENGTH && HASHTAG.test(tag) && !DIGITS_ONLY.test(tag);
}

// What someone typed in the editor's box ("#bread, #lisbon sourdough"):
// words separated by spaces or commas, each with or without its "#". Each
// hashtag once (case doesn't matter; the first spelling stays). Words that
// can't be a hashtag are listed apart, for the message under the box.
export function readTypedHashtags(text: string): TypedHashtags {
  const hashtags: string[] = [];
  const invalid: string[] = [];
  for (const word of text.normalize("NFC").split(/[\s,]+/u)) {
    const tag = word.replace(/^#+/u, "");
    if (!tag) {
      continue;
    }
    if (isValidHashtag(tag)) {
      pushOnce(hashtags, tag);
    } else {
      invalid.push(word);
    }
  }
  return { hashtags, invalid };
}

// The hashtags the AI wrote: "#" and spaces taken out, those that still
// can't be a hashtag left out, each once, at most DRAFT_HASHTAGS_MAX. Runs
// of marks are cut before composing (draft-text.ts says why).
export function cleanModelHashtags(tags: string[]): string[] {
  const kept: string[] = [];
  for (const raw of tags) {
    const tag = cutRunsOfMarks(raw).normalize("NFC").replace(/^#+/u, "").replace(/\s+/gu, "");
    if (isValidHashtag(tag)) {
      pushOnce(kept, tag);
    }
  }
  return kept.slice(0, DRAFT_HASHTAGS_MAX);
}

// "#bread #lisbon": as a post shows them, and as the editor's box starts.
export function formatHashtags(hashtags: readonly string[]): string {
  return hashtags.map((tag) => `#${tag}`).join(" ");
}

function pushOnce(list: string[], tag: string): void {
  const key = tag.toLowerCase();
  if (!list.some((existing) => existing.toLowerCase() === key)) {
    list.push(tag);
  }
}
