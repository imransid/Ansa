import "server-only";
import { readHeader } from "@/lib/email-headers";
import type { EmailSender } from "./inbound-email-sender";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Mail that must not become a ticket on its own: mail from the company's own
// support addresses, automatic replies, bulk mail, bounces, and floods from one
// sender. Returns the reason code (lib/inbound-email-reasons.ts), or null.
// Nothing is lost: each one is listed on the Emails page, where anyone in the
// company can still make it a ticket. Mail from ansa's own addresses (a loop)
// never gets here: services/inbound-email-processing.ts stops it first, in
// every run. supportAddresses: the company's, as listed on Setup.
export async function findReasonToIgnore(
  companyId: string,
  sender: EmailSender,
  headers: Record<string, string>,
  supportAddresses: string[],
): Promise<string | null> {
  // First, so mail from the company's own mailbox is always called that,
  // whatever else the email looks like.
  if (sender.ownAddress === "company" && !isFromOwnGroupOnSomeonesBehalf(sender, headers)) {
    return "support_address";
  }
  if (isAutomaticReply(headers)) {
    return "auto_reply";
  }
  if (isBulkMail(headers, supportAddresses)) {
    return "bulk";
  }
  if (/^(mailer-daemon|postmaster)@/.test(sender.shownAddress ?? "")) {
    return "bounce";
  }
  if (await isOverRateLimit("inbound-email", `${companyId}:${sender.floodKey}`, RATE_LIMITS.inboundEmailsPerSender)) {
    return "rate_limited";
  }
  return null;
}

// Google Groups writes the group's own address in From when the author's
// domain tells receivers to refuse mail sent in its name by others (DMARC
// p=quarantine or p=reject), and names the author in Reply-To:
//   From: 'Ana' via Support <support@acme.com>, List-Id: <support.acme.com>,
//   Reply-To: ana@yahoo.com
// That is a customer writing through the company's own group, not its mailbox
// writing: it goes on like any email with a Reply-To (the author is suggested
// to an expert, never filled in, and is the flood key).
function isFromOwnGroupOnSomeonesBehalf(sender: EmailSender, headers: Record<string, string>): boolean {
  if (!sender.address || !sender.replyToAddress) {
    return false;
  }
  return isOwnMailingList(readHeader(headers, "list-id"), [sender.address]);
}

// RFC 3834's Auto-Submitted (anything but "no"), Precedence: auto_reply, the
// X-Autoreply / X-Autorespond headers many mail programs add, and an empty
// Return-Path (automatic messages are sent with no return address).
function isAutomaticReply(headers: Record<string, string>): boolean {
  const markers = [readHeader(headers, "auto-submitted"), readHeader(headers, "x-autoreply"), readHeader(headers, "x-autorespond")];
  if (markers.some((value) => value.trim() !== "" && value.trim().toLowerCase() !== "no")) {
    return true;
  }
  if (readHeader(headers, "precedence").trim().toLowerCase() === "auto_reply") {
    return true;
  }
  return readHeader(headers, "return-path").trim() === "<>";
}

// Precedence bulk, junk or list, or the List-Id / List-Unsubscribe headers
// newsletters and mailing lists send (Gmail and Yahoo require
// List-Unsubscribe from bulk senders, while many leave Precedence out).
// Except the company's OWN mailing list: when its support address is a Google
// Group, every customer email arrives with these headers.
function isBulkMail(headers: Record<string, string>, supportAddresses: string[]): boolean {
  const precedence = readHeader(headers, "precedence").trim().toLowerCase();
  const listId = readHeader(headers, "list-id");
  const hasBulkMarker = ["bulk", "junk", "list"].includes(precedence) || listId.trim() !== "" || readHeader(headers, "list-unsubscribe").trim() !== "";
  return hasBulkMarker && !isOwnMailingList(listId, supportAddresses);
}

// A list writes its own address, "@" as a dot, in angle brackets:
// support@acme.com -> List-Id: <support.acme.com> (Google Groups does).
// Anyone can write this header, but all it can do is make an email a ticket,
// as it would be without the header.
function isOwnMailingList(listId: string, supportAddresses: string[]): boolean {
  const listName = listId.match(/<([^<>]+)>\s*$/)?.[1]?.trim().toLowerCase();
  if (!listName) {
    return false;
  }
  return supportAddresses.some((address) => address.replace("@", ".") === listName);
}
