import type { InboundEmailStatus } from "@/db/schema";

// Received emails as the Setup page and a ticket's page read them: the last
// one that reached the company, and the customer's original email behind an
// email ticket.

// The last email that reached one company, and what became of it.
export type LastInboundEmail = {
  receivedAt: Date;
  status: InboundEmailStatus;
  ignoredReason: string | null;
  ticketNumber: number | null;
  // Its processing never finished: the same rule as the Emails page
  // (isStuckInboundEmail), where "Process again" is.
  stuck: boolean;
};

export type OriginalEmail = {
  fromAddress: string | null;
  // False: the email didn't pass DKIM or DMARC, so anyone could have written
  // that From address (see db/schema/inbound-emails.ts).
  senderVerified: boolean;
  // A Reply-To that differs from From (contact forms put the customer there).
  replyToAddress: string | null;
  subject: string | null;
  body: string | null;
  // The email had no plain-text part: the body is text made from its HTML
  // part, or null when that held no text.
  bodyFromHtml: boolean;
  attachmentCount: number;
  attachmentNames: string[];
  // Images shown inside the email (logos, pasted pictures), not attachments.
  inlineImageCount: number;
  // The subject, body or file names are stored but can't be decrypted (a
  // wrong DATA_ENCRYPTION_KEY): the page says so, instead of showing an empty
  // email that someone might close as nothing.
  unreadable: boolean;
  receivedAt: Date;
};
