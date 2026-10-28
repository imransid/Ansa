import { phoneDigits } from "./phone-number";

// Turning what someone typed in a list's search box into what the database
// looks for (db/ticket-filters.ts, db/call-filters.ts).

// A phone number search needs at least this many digits: fewer would match
// almost every number.
const MIN_PHONE_SEARCH_DIGITS = 3;

// Characters people write phone numbers with, besides digits.
const PHONE_NUMBER_TEXT = /^[\d\s+().-]+$/;

// The largest ticket number Postgres can store (an integer column).
const LARGEST_TICKET_NUMBER = 2_147_483_647;

// An ILIKE pattern that finds the text anywhere: "%text%". A backslash, % or
// _ in the text gets a backslash in front (Postgres's default LIKE escape
// character), so it matches itself instead of acting as a wildcard: a search
// for "100%" finds "100% refund", not every subject starting with "100".
export function containsPattern(text: string): string {
  const escaped = text.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

// The digits of a search that looks like a phone number, so "+1 (555)
// 010-0199" finds "+15550100199" however either was written. Null when the
// search holds anything else, or fewer than 3 digits.
export function phoneDigitsInSearch(text: string): string | null {
  if (!PHONE_NUMBER_TEXT.test(text)) {
    return null;
  }
  const digits = phoneDigits(text);
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : null;
}

// The ticket number a search names: "#57" or "57". Null otherwise.
export function ticketNumberInSearch(text: string): number | null {
  const match = /^#?(\d{1,10})$/.exec(text);
  if (!match) {
    return null;
  }
  const ticketNumber = Number(match[1]);
  return ticketNumber >= 1 && ticketNumber <= LARGEST_TICKET_NUMBER ? ticketNumber : null;
}
