// Shared by the server's customer email check (lib/validation/customer-email.ts)
// and the ticket page's confirm step, so the expert confirms exactly the
// address that gets saved. No imports: it also runs in the browser.

// Letters of any script, marks, digits, dots and hyphens: all a domain name
// can hold. Anything else ("/", "%", "@", a space) is left for the check to
// refuse, never "repaired" into a different domain the way URL parsing would
// ("example.com/x" -> "example.com").
const DOMAIN_CHARACTERS = /^[\p{L}\p{M}\p{N}.-]+$/u;

// Printable ASCII only: such a domain needs no conversion.
const PRINTABLE_ASCII = /^[ -~]*$/;

// Trims and lowercases an address, and writes an international domain the way
// mail servers need it: "ivan@почта.рф" -> "ivan@xn--80a1acny.xn--p1ai". It
// never decides whether the address is valid; lib/validation/customer-email.ts does.
export function normalizeEmailAddress(text: string): string {
  const address = text.trim().toLowerCase();
  const atIndex = address.lastIndexOf("@");
  const domain = address.slice(atIndex + 1);
  if (atIndex <= 0 || PRINTABLE_ASCII.test(domain) || !DOMAIN_CHARACTERS.test(domain)) {
    return address;
  }
  return `${address.slice(0, atIndex)}@${toAsciiDomain(domain)}`;
}

// The browser's and Node's own conversion (the WHATWG URL host parser, which
// node:url's domainToASCII uses too). A domain it can't convert stays as it
// was, and the check then refuses it.
function toAsciiDomain(domain: string): string {
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    return domain;
  }
}
