import "server-only";
import {
  countUndeliveredEmailsForCompany,
  getUndeliveredEmailsForCompany,
  type UndeliveredCustomerEmail,
} from "@/db/undelivered-emails";
import type { SessionContext } from "@/lib/session";

// Re-exported so pages can use the type without importing from /db.
export type { UndeliveredCustomerEmail };

// How many the Emails page lists; the count says how many there are in all.
const LISTED_UNDELIVERED_EMAILS = 20;

// The session's company's "solved" emails that never reached the customer
// (failed, not sent, or bounced, suppressed or failed at Resend), most recent
// first, for the Emails page (step 27). Each ticket's page has the details and
// the Retry button.
export async function listUndeliveredCustomerEmailsForSession(session: SessionContext): Promise<UndeliveredCustomerEmail[]> {
  return getUndeliveredEmailsForCompany(session.companyId, LISTED_UNDELIVERED_EMAILS);
}

// How many of the session's company's "solved" emails never reached the
// customer, for the notice on the dashboard.
export async function countUndeliveredCustomerEmailsForSession(session: SessionContext): Promise<number> {
  return countUndeliveredEmailsForCompany(session.companyId);
}
