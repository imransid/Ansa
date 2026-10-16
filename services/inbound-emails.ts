import "server-only";
import { getInboundEmailForTicket } from "@/db/inbound-emails";
import { decryptText } from "@/lib/encryption";
import { inboundEmailBodyContext, inboundEmailSubjectContext } from "@/lib/encryption-contexts";
import type { SessionContext } from "@/lib/session";

export type OriginalEmail = {
  fromAddress: string | null;
  subject: string | null;
  body: string | null;
  receivedAt: Date;
};

// The customer's original email behind a ticket of the session's company, if
// the ticket came from email. Decrypted for the expert reading the ticket.
export async function getOriginalEmailForSession(session: SessionContext, ticketId: string): Promise<OriginalEmail | null> {
  const row = await getInboundEmailForTicket(session.companyId, ticketId);
  if (!row) {
    return null;
  }
  return {
    fromAddress: row.fromAddress,
    subject: decryptOrNull(row.subjectEncrypted, inboundEmailSubjectContext(session.companyId, row.id)),
    body: decryptOrNull(row.bodyEncrypted, inboundEmailBodyContext(session.companyId, row.id)),
    receivedAt: row.receivedAt,
  };
}

function decryptOrNull(encrypted: string | null, context: string): string | null {
  if (!encrypted) {
    return null;
  }
  try {
    return decryptText(encrypted, context);
  } catch {
    // Never log the ciphertext or anything from the email.
    console.error("Could not decrypt a stored email");
    return null;
  }
}
