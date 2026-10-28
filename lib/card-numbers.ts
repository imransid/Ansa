// Payment-card-like numbers: 13 to 19 digits, optionally split by spaces or dashes.
const CARD_LIKE_NUMBER = /\b\d(?:[ -]?\d){12,18}\b/g;

// Replaces card-like numbers with "[number]". One rule for every place a
// customer's own words go further than their message: the call and email
// slices sent to Claude, and an email's subject when it becomes a ticket
// subject (stored plainly and sent in assignment emails).
export function redactCardNumbers(text: string): string {
  return text.replace(CARD_LIKE_NUMBER, "[number]");
}
