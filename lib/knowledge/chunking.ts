import { KNOWLEDGE_CHUNK_MAX_LENGTH } from "./limits";

// Cutting an article into the pieces the search indexes and the AI reads
// (step 34), and an imported text into articles (./article-parts.ts). Pure:
// the same text always gives the same pieces.

// The pieces of one article's body, each at most 1,500 characters.
export function chunkArticleBody(body: string): string[] {
  return packParagraphs(body, KNOWLEDGE_CHUNK_MAX_LENGTH);
}

// Packs whole paragraphs into pieces of at most maxLength characters, joined
// by a blank line. A paragraph longer than that is cut into pieces of its
// own: between sentences, else between words, else anywhere. Never an empty
// piece, and no piece starts or ends with spaces or line breaks.
export function packParagraphs(text: string, maxLength: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const paragraph of splitIntoParagraphs(text)) {
    if (paragraph.length > maxLength) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      pieces.push(...cutLongParagraph(paragraph, maxLength));
      continue;
    }
    const joined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (joined.length <= maxLength) {
      current = joined;
    } else {
      pieces.push(current);
      current = paragraph;
    }
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
}

// The text between blank lines (lines holding only spaces count as blank),
// each paragraph trimmed. Line breaks inside a paragraph stay.
export function splitIntoParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() !== "") {
      lines.push(line);
      continue;
    }
    if (lines.length > 0) {
      paragraphs.push(lines.join("\n").trim());
      lines = [];
    }
  }
  if (lines.length > 0) {
    paragraphs.push(lines.join("\n").trim());
  }
  return paragraphs;
}

// Cuts one paragraph (already trimmed) into pieces of at most maxLength.
function cutLongParagraph(paragraph: string, maxLength: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > maxLength) {
    const cutAt = findCut(rest, maxLength);
    pieces.push(rest.slice(0, cutAt).trimEnd());
    rest = rest.slice(cutAt).trimStart();
  }
  if (rest) {
    pieces.push(rest);
  }
  return pieces;
}

// Where to cut text that is longer than maxLength: after the last sentence
// that ends within it (". ", "! ", "? ", also after a closing quote or
// bracket), else at the last space, else at maxLength itself. Always above 0,
// so every cut moves forward.
function findCut(text: string, maxLength: number): number {
  const window = text.slice(0, maxLength + 1);
  let sentenceEnd = 0;
  for (const match of window.matchAll(/[.!?]["'”’)\]]*(?=\s)/g)) {
    sentenceEnd = match.index + match[0].length;
  }
  if (sentenceEnd > 0) {
    return sentenceEnd;
  }
  for (let index = maxLength; index > 0; index--) {
    if (/\s/.test(window[index])) {
      return index;
    }
  }
  return hardCut(text, maxLength);
}

// maxLength, or one less when that would split a character outside the
// Basic Multilingual Plane (an emoji) into two invalid halves.
function hardCut(text: string, maxLength: number): number {
  const lastCode = text.charCodeAt(maxLength - 1);
  const isHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return isHighSurrogate ? maxLength - 1 : maxLength;
}
