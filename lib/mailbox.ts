import { toPlainSingleLine } from "@/lib/plain-text";

// The longest display name kept (tickets.customer_name allows 200).
const MAX_NAME_LENGTH = 200;

// The address is the LAST <...> group, at the very end. Everything before it is
// the display name, even when that holds quotes, commas or another "<".
const ADDRESS_IN_ANGLE_BRACKETS_AT_END = /<([^<>]*)>\s*$/;

// The old "ana@example.com (Ana Smith)" form: one address, then a comment.
const ADDRESS_THEN_COMMENT = /^([^\s()<>@]+@[^\s()<>@]+)\s*\(([^()]*)\)$/;

export type Mailbox = { name: string | null; address: string };

// Reads one mailbox of a From, To or Reply-To header, in any of these forms:
//   Ana Smith <ana@example.com>         "Smith, Ana \"AJ\"" <ana@example.com>
//   ana@example.com (Ana Smith)         ana@example.com
// Returns the display name (one plain line, at most 200 characters, or null)
// and the address in lowercase. The address is NOT checked here: callers do
// that (lib/validation/customer-email.ts).
export function parseMailbox(mailbox: string): Mailbox {
  const text = mailbox.trim();
  const inAngleBrackets = text.match(ADDRESS_IN_ANGLE_BRACKETS_AT_END);
  if (inAngleBrackets && inAngleBrackets.index !== undefined) {
    return { name: cleanDisplayName(text.slice(0, inAngleBrackets.index)), address: inAngleBrackets[1].trim().toLowerCase() };
  }
  const withComment = text.match(ADDRESS_THEN_COMMENT);
  if (withComment) {
    return { name: cleanDisplayName(withComment[2]), address: withComment[1].toLowerCase() };
  }
  return { name: null, address: text.toLowerCase() };
}

// Drops the quotes around a quoted name and its backslash escapes
// ("Ana \"AJ\" Smith" -> Ana "AJ" Smith), then makes it one plain line.
function cleanDisplayName(rawName: string): string | null {
  let name = rawName.trim();
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  const cleaned = toPlainSingleLine(name).slice(0, MAX_NAME_LENGTH).trim();
  return cleaned || null;
}
