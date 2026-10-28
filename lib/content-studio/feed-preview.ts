import { PLATFORM_RULES } from "@/lib/content-rules";
import type { SocialPlatform } from "@/lib/social-platforms";

// Where a platform's feed cuts a long text behind "see more" (step 38), for
// the preview: roughly, as PLATFORM_RULES' feedCut says (apps differ by
// screen). Pure.

export type FeedText = {
  // What the feed shows before the cut (all of it when nothing is cut).
  shown: string;
  // The platform's own words for the rest ("...see more"), or null: not cut.
  moreLabel: string | null;
};

// The text as the feed first shows it: up to the line or character limit,
// whichever comes first. A cut inside a line ends at a space when one is
// near, so no word is shown half.
export function cutForFeed(platform: SocialPlatform, text: string): FeedText {
  const cut = PLATFORM_RULES[platform].feedCut;
  if (!cut) {
    return { shown: text, moreLabel: null };
  }
  const lineEnd = endOfLines(text, cut.lines);
  const characterEnd = endOfCharacters(text, cut.characters);
  if (Math.min(lineEnd, characterEnd) >= text.length) {
    return { shown: text, moreLabel: null };
  }
  if (lineEnd <= characterEnd) {
    return { shown: text.slice(0, lineEnd).trimEnd(), moreLabel: cut.moreLabel };
  }
  const kept = text.slice(0, characterEnd);
  const lastSpace = kept.search(/\s\S*$/u);
  const atWord = lastSpace > kept.length * 0.8 ? kept.slice(0, lastSpace) : kept;
  return { shown: atWord.trimEnd(), moreLabel: cut.moreLabel };
}

// Where the text's line number `lines` ends (its length when it has fewer).
function endOfLines(text: string, lines: number): number {
  let end = -1;
  for (let line = 0; line < lines; line++) {
    end = text.indexOf("\n", end + 1);
    if (end === -1) {
      return text.length;
    }
  }
  return end;
}

// Where `characters` characters end, never inside an emoji's two halves.
function endOfCharacters(text: string, characters: number): number {
  return [...text].slice(0, characters).join("").length;
}
