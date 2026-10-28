// Shared by the ticket history checks (step 30): a ticket's history rows as
// the database holds them, oldest first.

import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ticketActivity } from "@/db/schema";

export async function historyRows(ticketId: string) {
  return db
    .select({
      id: ticketActivity.id,
      companyId: ticketActivity.companyId,
      kind: ticketActivity.kind,
      actorUserId: ticketActivity.actorUserId,
      targetUserId: ticketActivity.targetUserId,
      category: ticketActivity.category,
      bodyEncrypted: ticketActivity.bodyEncrypted,
    })
    .from(ticketActivity)
    .where(eq(ticketActivity.ticketId, ticketId))
    .orderBy(asc(ticketActivity.createdAt));
}

// [kind, who did it, who it was about, category] for each row, oldest first,
// so a check can compare a ticket's whole history at once.
export async function historySummary(ticketId: string) {
  const rows = await historyRows(ticketId);
  return rows.map((row) => [row.kind, row.actorUserId, row.targetUserId, row.category]);
}
