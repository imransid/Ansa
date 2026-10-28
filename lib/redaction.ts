import { redactCardNumbers } from "@/lib/card-numbers";

// US social security numbers as people write them or speech-to-text spells
// them out: 123-45-6789 or 123 45 6789 (the same separator twice).
const SSN_LIKE_NUMBER = /\b\d{3}([- ])\d{2}\1\d{4}\b/g;

// An email address, international ones included. The lookbehind makes a match
// start only where a run of address characters starts: without it, a long
// run with no "@" (anyone can send one) would be rescanned from every
// position, which takes seconds.
const EMAIL_ADDRESS = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

// What the call and email slices hide from Claude (Rule: the smallest slice
// that does the job): card-like and social-security-like numbers become
// "[number]", email addresses "[email]". Claude needs none of them to decide
// a call or triage an email; the expert sees the original on the call page
// or the ticket.
export function redactForClaude(text: string): string {
  return redactSecretNumbers(text).replace(EMAIL_ADDRESS, "[email]");
}

// Card-like and social-security-like numbers become "[number]". What the
// Co-Founder's prompts hide (step 36): an owner may paste a card number into
// the interview by mistake, but the business's own email address is a fact
// worth keeping, so addresses stay.
export function redactSecretNumbers(text: string): string {
  return redactCardNumbers(text).replace(SSN_LIKE_NUMBER, "[number]");
}
