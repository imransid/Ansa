import "server-only";
import { normalizeEmailAddress } from "@/lib/email-address";
import { readHeader } from "@/lib/email-headers";
import { isOnInboundEmailDomain } from "@/lib/forwarding-address";
import type { InboundEmailContent } from "@/lib/inbound-email";
import { parseMailbox } from "@/lib/mailbox";
import { toPlainSingleLine } from "@/lib/plain-text";
import { isOurSendingAddress } from "@/lib/send-email";
import { readCustomerEmail } from "@/lib/validation/customer-email";

// The longest From text read. Mail servers fold long headers, so a real one is
// far shorter. Only its end is read (the <address> comes last), and a From
// that had to be cut is never verified: the part that was cut off could hold
// a second address (see hasOneAtSign).
const MAX_FROM_LENGTH = 2_000;

// The longest From text kept for the ticket when it holds no valid address.
const MAX_SHOWN_FROM_LENGTH = 320;

// Who sent a received email, as far as we can tell.
export type EmailSender = {
  // The display name, one plain line, at most 200 characters, or null.
  name: string | null;
  // The sender's address when it is a valid customer address (cleaned up), else null.
  address: string | null;
  // What the ticket shows as the sender: the address, or what From held when
  // it isn't a valid one (one plain line: a NUL or line break can't be stored
  // or shown). Null when the email had no From at all.
  shownAddress: string | null;
  // Resend's DKIM or DMARC check passed for a From with one address (step 25).
  verified: boolean;
  // Set when the sender is not a customer: "ansa" for ansa's own sending
  // address (EMAIL_FROM) or an address on our receiving domain (forwarding
  // addresses), "company" for one of the company's support addresses (listed
  // on Setup). Such an address is never filled in as the customer email.
  ownAddress: "ansa" | "company" | null;
  // The email's one Reply-To address, when valid and different from From:
  // website contact forms and other relays send from their own address and
  // put the customer here. Anyone can write it: a suggestion only.
  replyToAddress: string | null;
  // Counts this sender's emails for the hourly flood limit: the Reply-To when
  // there is one (every contact form submission comes from the same relay).
  floodKey: string;
};

// Reads the sender of a received email. Resend gives `from` as the bare
// address and keeps the display name only in headers.from, so both are read
// (the dev stand-in can also put "Name <address>" in `from`). companyAddresses:
// the company's support addresses, to recognise mail from its own mailbox.
export function readSender(content: InboundEmailContent, companyAddresses: string[]): EmailSender {
  const fullFromHeader = readHeader(content.headers, "from").trim();
  const fullFromField = content.from.trim();
  const fromWasCut = fullFromHeader.length > MAX_FROM_LENGTH || fullFromField.length > MAX_FROM_LENGTH;
  const fromHeader = fullFromHeader.slice(-MAX_FROM_LENGTH);
  const fromField = fullFromField.slice(-MAX_FROM_LENGTH);
  const mailbox = parseMailbox(fromField || fromHeader);
  const headerMailbox = fromHeader ? parseMailbox(fromHeader) : null;
  // headers.from, when present, must name the same address (written the same
  // way: "почта.рф" and its ASCII form are one domain). Otherwise it is unclear
  // which of the two Resend checked, and its name may be someone else's.
  const fromTextsAgree = headerMailbox === null || normalizeEmailAddress(headerMailbox.address) === normalizeEmailAddress(mailbox.address);
  const address = readCustomerEmail(mailbox.address);
  const shownAddress = address ?? (toPlainSingleLine(mailbox.address).slice(0, MAX_SHOWN_FROM_LENGTH) || null);
  const replyToAddress = readReplyToAddress(content.reply_to ?? [], address, companyAddresses);
  return {
    name: mailbox.name ?? (headerMailbox && fromTextsAgree ? headerMailbox.name : null),
    address,
    shownAddress,
    verified: address !== null && fromTextsAgree && !fromWasCut && isVerifiedSender([fromField, fromHeader], content.authentication),
    ownAddress: findOwnAddressKind(shownAddress ?? "", companyAddresses),
    replyToAddress,
    floodKey: replyToAddress ?? shownAddress ?? "unknown sender",
  };
}

// True when Resend saw a passing DKIM signature (made by the sender's own
// domain) or a passing DMARC check, and every From we were given holds one
// address only. A pass on SPF alone is not enough: once a company forwards its
// mailbox to us, SPF checks the forwarding server, not the sender.
// Authentication-Results headers are never read: anyone can write them into an
// email. Missing results (null) mean not verified.
function isVerifiedSender(fromTexts: string[], authentication: InboundEmailContent["authentication"]): boolean {
  if (!fromTexts.filter(Boolean).every(hasOneAtSign)) {
    return false;
  }
  return authentication?.dkim === "pass" || authentication?.dmarc === "pass";
}

// Resend checks DKIM and DMARC against the From address as ITS parser reads
// it, and parseMailbox may read a different one: for "attacker@evil.com
// <victim@bank.com>" Resend could have checked evil.com while we take
// victim@bank.com. With a single "@" there is only one address to read. A
// copy of the address in the name ("ana@x.com" <ana@x.com>) fails this too;
// an expert confirms those.
function hasOneAtSign(fromText: string): boolean {
  const atSigns = [...fromText].filter((character) => character === "@");
  return atSigns.length === 1;
}

// "ansa" for ansa's own sending address and anything on our receiving domain
// (mail from them is a loop), "company" for one of the company's support
// addresses (mail its own mailbox sent), null for anyone else.
function findOwnAddressKind(address: string, companyAddresses: string[]): EmailSender["ownAddress"] {
  if (!address) {
    return null;
  }
  if (isOurSendingAddress(address) || isOnInboundEmailDomain(address)) {
    return "ansa";
  }
  return companyAddresses.includes(address) ? "company" : null;
}

// One Reply-To, a valid address, and not the sender's own: anything else
// (none, several, the same address) is no suggestion. Our own addresses are
// left out first: a Google Group set to "reply to the group" puts its own
// address in Reply-To on every email it passes on, and that is never the
// customer.
function readReplyToAddress(replyTo: string[], senderAddress: string | null, companyAddresses: string[]): string | null {
  const addresses = replyTo.map((entry) => parseMailbox(entry).address);
  const notOurs = addresses.filter((address) => findOwnAddressKind(normalizeEmailAddress(address), companyAddresses) === null);
  if (notOurs.length !== 1) {
    return null;
  }
  const address = readCustomerEmail(notOurs[0]);
  return address && address !== senderAddress ? address : null;
}
