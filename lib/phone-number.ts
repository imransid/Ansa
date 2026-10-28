// Phone numbers arrive written in many ways ("+1 555 0177", "+15550177",
// "(555) 0177"), so they are compared by their digits only.

// A number with fewer digits than this can't tell two customers apart:
// "anonymous", "Restricted", "unknown" (no digits at all) or a short code.
// Two of those must never count as the same customer (db/same-customer.ts).
const MIN_DIGITS_TO_RECOGNISE_A_CUSTOMER = 7;

// What a carrier sends instead of a hidden caller's number. Twilio, which many
// Vapi numbers run on, spells a word on the phone keypad: "+266696687" is
// ANONYMOUS. Every hidden caller gets the same one, so these must never count
// as the same customer either. Shorter placeholders (such as "+464") already
// fall under the 7-digit minimum. Add any other carrier's placeholder here
// once a real call shows it (CLAUDE.md, Known gaps).
const HIDDEN_CALLER_PLACEHOLDERS = new Set([
  "266696687", // ANONYMOUS
  "7378742833", // RESTRICTED
  "86282452253", // UNAVAILABLE
  "8656696", // UNKNOWN
  "2562533", // BLOCKED
]);

// Every digit of the text, in order: "+1 (555) 010-0199" -> "15550100199".
export function phoneDigits(text: string): string {
  return text.replace(/\D/g, "");
}

// The digits that identify a customer by their phone number, or null when the
// number is missing, too short to tell customers apart, or a stand-in for a
// hidden number. This is the only gate: repeat-customer routing and the
// ticket page's "Other open tickets from this customer" both go through it.
export function customerPhoneDigits(phone: string | null): string | null {
  if (!phone) {
    return null;
  }
  const digits = phoneDigits(phone);
  if (digits.length < MIN_DIGITS_TO_RECOGNISE_A_CUSTOMER) {
    return null;
  }
  if (HIDDEN_CALLER_PLACEHOLDERS.has(digits) || isOneDigitRepeated(digits)) {
    return null;
  }
  return digits;
}

// "0000000000": what some phone systems send when they have no number.
function isOneDigitRepeated(digits: string): boolean {
  return new Set(digits).size === 1;
}
