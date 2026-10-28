import { isValidHashtag } from "@/lib/content-studio/hashtags";

// LinkedIn's Posts API reads a post's text ("commentary") in its "little"
// text format, where these characters start mentions, hashtags and
// templates. LinkedIn says to escape every one with a backslash, used or
// not, or the post can lose text (an unescaped "(" can cut it short). A
// hashtag becomes its hashtag template, as LinkedIn itself writes them back
// ("{hashtag|\#|bread}"), so it still links. From learn.microsoft.com's
// "little Text Format" (read 2026-10-28). NOT TESTED against LinkedIn.

const RESERVED_CHARACTER = /[\\|{}@[\]()<>#*_~]/gu;

// "#" at the start or after a space, then the word a hashtag can be
// (lib/content-studio/hashtags.ts decides which words can).
const HASHTAG = /(^|\s)#([\p{L}\p{M}\p{N}_]+)/gu;

// The text as LinkedIn's commentary field must hold it.
export function toLinkedInLittleText(text: string): string {
  let converted = "";
  let copiedUpTo = 0;
  for (const match of text.matchAll(HASHTAG)) {
    const [, spaceBefore, tag] = match;
    if (!isValidHashtag(tag)) {
      continue;
    }
    const hashSign = match.index + spaceBefore.length;
    converted += `${escapeLittleText(text.slice(copiedUpTo, hashSign))}{hashtag|\\#|${escapeLittleText(tag)}}`;
    copiedUpTo = hashSign + 1 + tag.length;
  }
  return converted + escapeLittleText(text.slice(copiedUpTo));
}

function escapeLittleText(text: string): string {
  return text.replace(RESERVED_CHARACTER, (character) => `\\${character}`);
}
