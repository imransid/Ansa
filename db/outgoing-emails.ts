import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { firstTryIsRecentEnoughToRepeat, HELD_BACK_BY_DAILY_LIMIT, isDeliveryInProgress } from "./outgoing-email-delivery";
import { outgoingEmails, type DeliveryProblem, type EmailStatus } from "./schema";

// The ticket page's view of a customer email. Delivering one is in
// db/outgoing-email-delivery.ts.

export type CustomerEmailSummary = {
  id: string;
  status: EmailStatus;
  toEmail: string;
  sentAt: Date | null;
  providerMessageId: string | null;
  deliveryProblem: DeliveryProblem | null;
  // Its last delivery attempt was held back by the company's daily limit.
  heldBackByDailyLimit: boolean;
  // A delivery is on its way right now, so the page offers no Retry yet.
  deliveryInProgress: boolean;
  // Its first try was 23 or more hours ago, past what Resend's idempotency
  // key covers: Retry asks before sending it again.
  mayAlreadyHaveBeenDelivered: boolean;
};

// Reads the most recent email of one ticket of one company. The time rules
// are worked out by the database, on the same clock the delivery claim uses.
export async function getLatestEmailForTicket(
  companyId: string,
  ticketId: string,
): Promise<CustomerEmailSummary | undefined> {
  const [email] = await db
    .select({
      id: outgoingEmails.id,
      status: outgoingEmails.status,
      toEmail: outgoingEmails.toEmail,
      sentAt: outgoingEmails.sentAt,
      providerMessageId: outgoingEmails.providerMessageId,
      deliveryProblem: outgoingEmails.deliveryProblem,
      lastError: outgoingEmails.lastError,
      deliveryInProgress: sql<boolean>`coalesce(${isDeliveryInProgress()}, false)`,
      mayAlreadyHaveBeenDelivered: sql<boolean>`not ${firstTryIsRecentEnoughToRepeat()}`,
    })
    .from(outgoingEmails)
    .where(
      and(
        eq(outgoingEmails.companyId, companyId),
        eq(outgoingEmails.ticketId, ticketId),
      ),
    )
    .orderBy(desc(outgoingEmails.createdAt))
    .limit(1);
  if (!email) {
    return undefined;
  }
  // The page only needs to know whether the limit held it back, not the error code.
  const { lastError, ...summary } = email;
  return { ...summary, heldBackByDailyLimit: lastError === HELD_BACK_BY_DAILY_LIMIT };
}
