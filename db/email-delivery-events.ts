import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import { outgoingEmails, type DeliveryProblem } from "./schema";

// Records that a sent email bounced or was marked as spam. The first problem
// reported wins; repeats of the same webhook change nothing.
// Not company-scoped on purpose: a webhook has no session, only Resend's email
// id (unique to one email of one company). Call this only after the webhook
// signature is verified. Returns false if no sent email has that id.
export async function markDeliveryProblem(providerMessageId: string, problem: DeliveryProblem): Promise<boolean> {
  const updated = await db
    .update(outgoingEmails)
    .set({ deliveryProblem: problem, deliveryProblemAt: new Date() })
    .where(
      and(
        eq(outgoingEmails.providerMessageId, providerMessageId),
        eq(outgoingEmails.status, "sent"),
        isNull(outgoingEmails.deliveryProblem),
      ),
    )
    .returning({ id: outgoingEmails.id });
  return updated.length > 0;
}
