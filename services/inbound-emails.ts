import "server-only";
import { countInboundEmailsForCompany, getInboundEmailsForCompany, type InboundEmailListItem } from "@/db/inbound-email-list";
import { getInboundEmailForTicket } from "@/db/inbound-emails";
import { decryptForDisplay } from "@/lib/encryption";
import {
  inboundEmailAttachmentsContext,
  inboundEmailBodyContext,
  inboundEmailSubjectContext,
} from "@/lib/encryption-contexts";
import type { SessionContext } from "@/lib/session";

// Re-exported so pages can use the type without importing from /db.
export type { InboundEmailListItem };

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

// The customer's original email behind a ticket of the session's company, if
// the ticket came from email. Decrypted for the expert reading the ticket.
export async function getOriginalEmailForSession(session: SessionContext, ticketId: string): Promise<OriginalEmail | null> {
  const row = await getInboundEmailForTicket(session.companyId, ticketId);
  if (!row) {
    return null;
  }
  const subject = decryptForDisplay(row.subjectEncrypted, inboundEmailSubjectContext(session.companyId, row.id));
  const body = decryptForDisplay(row.bodyEncrypted, inboundEmailBodyContext(session.companyId, row.id));
  const names = decryptForDisplay(row.attachmentNamesEncrypted, inboundEmailAttachmentsContext(session.companyId, row.id));
  return {
    fromAddress: row.fromAddress,
    senderVerified: row.senderVerified,
    replyToAddress: row.replyToAddress,
    subject: subject.text,
    body: body.text,
    bodyFromHtml: row.bodyFromHtml,
    attachmentCount: row.attachmentCount,
    attachmentNames: readNameList(names.text),
    inlineImageCount: row.inlineImageCount,
    unreadable: subject.unreadable || body.unreadable || names.unreadable,
    receivedAt: row.receivedAt,
  };
}

// Lists one page of the session's company's received emails, newest first:
// who sent each one, what became of it, and its ticket (step 27).
export async function listInboundEmailsForSession(session: SessionContext, page = 1): Promise<InboundEmailListItem[]> {
  return getInboundEmailsForCompany(session.companyId, page);
}

// Counts the session's company's received emails.
export async function countInboundEmailsForSession(session: SessionContext): Promise<number> {
  return countInboundEmailsForCompany(session.companyId);
}

// The stored JSON list of file names; anything else reads as none.
function readNameList(json: string | null): string[] {
  if (!json) {
    return [];
  }
  try {
    const names: unknown = JSON.parse(json);
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}
