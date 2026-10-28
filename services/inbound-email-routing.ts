import "server-only";
import { findCompaniesForInboundTokens } from "@/db/inbound-emails";
import { readForwardingToken } from "@/lib/forwarding-address";
import { parseMailbox } from "@/lib/mailbox";
import type { ReceivedEmailRecipients } from "@/lib/validation/resend";

export type ReceivedEmailRouting =
  | { outcome: "company"; companyId: string }
  | { outcome: "no-forwarding-address" }
  | { outcome: "several-companies" };

// Decides which company one received email belongs to (step 24). Only a
// forwarding address ansa made (c-<token>@INBOUND_EMAIL_DOMAIN) counts; the
// support addresses companies type, and our own sending address, never do.
//
// WHY all four fields: normally Resend puts the address it delivered to (the
// forwarding address) in `to`, but in May 2026 it showed the email's own To
// header there by mistake, and cc, bcc and received_for come from headers the
// sender writes. Reading all four is safe ONLY because nobody but ansa can
// make a forwarding address: writing a company's address into an email just
// sends your own email to that company.
//
// Exactly one company, or the email is not taken: a delivery that names two
// companies' addresses is ignored, never handed to the first one listed.
export async function findCompanyForReceivedEmail(recipients: ReceivedEmailRecipients): Promise<ReceivedEmailRouting> {
  const tokens = forwardingTokensIn(recipients);
  const companyIds = await findCompaniesForInboundTokens(tokens);
  if (companyIds.length === 0) {
    return { outcome: "no-forwarding-address" };
  }
  if (companyIds.length > 1) {
    return { outcome: "several-companies" };
  }
  return { outcome: "company", companyId: companyIds[0] };
}

// The distinct tokens of every forwarding address in the four recipient lists.
function forwardingTokensIn(recipients: ReceivedEmailRecipients): string[] {
  const everyRecipient = [...recipients.to, ...recipients.cc, ...recipients.bcc, ...recipients.received_for];
  const tokens = new Set<string>();
  for (const recipient of everyRecipient) {
    const token = readForwardingToken(parseMailbox(recipient).address);
    if (token) {
      tokens.add(token);
    }
  }
  return [...tokens];
}
