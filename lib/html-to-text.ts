// Turns an email's HTML part into plain text, for emails that have no
// plain-text part (many website contact forms send HTML only). The result is
// stored and shown as text (React escapes it), never as HTML.
//
// A small scanner instead of regular expressions: every step moves forward
// with indexOf, so even hostile HTML (thousands of unclosed tags) takes time
// in proportion to its length. Inline images (base64 data: URIs, often
// megabytes) sit inside tags and are skipped with them. Not a full HTML
// parser: a ">" inside a quoted attribute ends the tag early, and the rest of
// that tag shows as text; and, as in a browser, a <title>, <style> or <script>
// that is never closed hides everything after it (the ticket then says the
// HTML held no text). Good enough to read what the customer wrote.

import { decodeNamedEntity } from "@/lib/html-entities";

// Elements whose content is never text a person reads. WHY not "head": its
// closing tag is optional and often left out, and skipping to it would then
// skip the whole email. What it holds is skipped anyway: title, style and
// script here, and meta and link hold no text.
const SKIPPED_ELEMENTS = new Set(["script", "style", "title", "template", "noscript", "svg"]);

// Elements that start or end a line.
const LINE_BREAKING_ELEMENTS = new Set([
  "br", "p", "div", "li", "tr", "table", "ul", "ol", "hr", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer",
  "dl", "dt", "dd", "caption", "center", "address", "figure", "figcaption",
  "form", "fieldset", "legend", "main", "nav", "aside",
]);

// Table cells get a tab before them, so a contact form's "Email" and
// "ana@example.com" in one row don't run together.
const TABLE_CELLS = new Set(["td", "th"]);

// The plain text of an HTML document, stopping once it has more than
// maxCharacters (the caller cuts it and says so).
export function htmlToPlainText(html: string, maxCharacters: number): string {
  const parts: string[] = [];
  let collected = 0;
  let position = 0;
  while (position < html.length && collected <= maxCharacters) {
    const tagStart = html.indexOf("<", position);
    const text = readableText(html.slice(position, tagStart === -1 ? html.length : tagStart));
    parts.push(text);
    collected += text.length;
    if (tagStart === -1) {
      break;
    }
    position = skipTag(html, tagStart, parts);
  }
  return tidyLines(parts.join(""));
}

// Text between two tags as a browser shows it: entities decoded, runs of
// spaces and line breaks as one space (lines come from the tags).
function readableText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ");
}

// Moves past the tag (or comment) starting at tagStart, adding a line break
// or a cell's tab for elements that make one, and returns where the text goes on.
function skipTag(html: string, tagStart: number, parts: string[]): number {
  if (html.startsWith("<!--", tagStart)) {
    const commentEnd = html.indexOf("-->", tagStart + 4);
    return commentEnd === -1 ? html.length : commentEnd + 3;
  }
  const tagEnd = html.indexOf(">", tagStart + 1);
  if (tagEnd === -1) {
    // An unclosed "<": what follows is not text anyone wrote.
    return html.length;
  }
  const isClosingTag = html[tagStart + 1] === "/";
  const name = readTagName(html.slice(tagStart + (isClosingTag ? 2 : 1), tagEnd));
  if (SKIPPED_ELEMENTS.has(name) && !isClosingTag) {
    return skipPastClosingTag(html, name, tagEnd + 1);
  }
  if (LINE_BREAKING_ELEMENTS.has(name)) {
    parts.push("\n");
  } else if (TABLE_CELLS.has(name) && !isClosingTag) {
    parts.push("\t");
  }
  return tagEnd + 1;
}

// "p class=x" -> "p", "br/" -> "br".
function readTagName(tagContent: string): string {
  return tagContent.slice(0, 30).toLowerCase().match(/^[a-z][a-z0-9]*/)?.[0] ?? "";
}

// Where the text goes on after the closing tag of a skipped element (</style>),
// or the end of the document when it never closes.
function skipPastClosingTag(html: string, name: string, from: number): number {
  const closingTag = new RegExp(`</${name}`, "gi");
  closingTag.lastIndex = from;
  const found = closingTag.exec(html);
  if (!found) {
    return html.length;
  }
  const closingEnd = html.indexOf(">", found.index);
  return closingEnd === -1 ? html.length : closingEnd + 1;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,9});/gi, (entity: string, body: string) => decodeEntity(entity, body));
}

function decodeEntity(entity: string, body: string): string {
  const lowerBody = body.toLowerCase();
  if (lowerBody.startsWith("#x")) {
    return fromCodePoint(Number.parseInt(lowerBody.slice(2), 16), entity);
  }
  if (lowerBody.startsWith("#")) {
    return fromCodePoint(Number.parseInt(lowerBody.slice(1), 10), entity);
  }
  // Names are case-sensitive: &Eacute; and &eacute; are different letters.
  return decodeNamedEntity(body) ?? entity;
}

function fromCodePoint(codePoint: number, fallback: string): string {
  return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : fallback;
}

// At most one empty line in a row.
function tidyLines(text: string): string {
  return text
    .split("\n")
    .map(tidyLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// One space between words, one tab between table cells, and nothing at
// either end of the line.
function tidyLine(line: string): string {
  return line
    .split("\t")
    .map((cell) => cell.replace(/ {2,}/g, " ").trim())
    .join("\t")
    .trim();
}
