// Control characters (line breaks, tabs, ...) plus the Unicode line and
// paragraph separators: each ends a line, or would in an email header.
const LINE_BREAKING_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

// Invisible format characters: a right-to-left override makes "gpj.exe" show
// as "exe.jpg", a zero-width space hides inside a word, and so on.
const INVISIBLE_FORMAT_CHARACTERS = /\p{Cf}/gu;

// Turns text written by a person, a customer or Claude into one plain line,
// for places where it is read exactly as it is: an email's subject or sender
// name, a ticket subject. Line breaks become spaces, invisible format
// characters are removed, and runs of spaces become one.
export function toPlainSingleLine(text: string): string {
  return text
    .replace(LINE_BREAKING_CHARACTERS, " ")
    .replace(INVISIBLE_FORMAT_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();
}
