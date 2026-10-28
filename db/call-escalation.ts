import "server-only";
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import { db } from "./client";
import { calls, tickets } from "./schema";
import { insertTicketWithNextNumber, type TicketToCreate } from "./ticket-creation";

// "Escalate to a ticket" on a call the AI marked solved (step 31): a teammate
// saw the AI got it wrong. The AI's verdict is never changed (ai_outcome and
// ai_reason_code stay as they were), so its accuracy can still be measured;
// who escalated, and when, are recorded on the call next to it.

export type EscalatedCallTicket = {
  ticketId: string;
  ticketNumber: number;
  // Who routing gave the ticket to, or null: to be emailed after commit.
  assignedToUserId: string | null;
};

// Escalates one company's call that the AI marked solved, in ONE transaction:
// records who escalated it (the session's own user) and when, then creates
// the call's ticket (history row "escalated", then routing). Returns
// undefined, changing nothing, when the call is not this company's, was not
// decided "solved", was escalated already, or already has a ticket: the
// UPDATE below checks every rule, so two escalations at once make one ticket.
// The call row is locked first, then the company row (ticket numbering), the
// same order as saving a decision (db/call-analysis.ts), so the two never
// wait for each other.
export async function escalateSolvedCall(
  companyId: string,
  callId: string,
  escalatedByUserId: string,
  ticket: TicketToCreate,
): Promise<EscalatedCallTicket | undefined> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(calls)
      .set({ escalatedByUserId, escalatedAt: sql`now()` })
      .where(
        and(
          eq(calls.id, callId),
          eq(calls.companyId, companyId),
          eq(calls.analysisStatus, "decided"),
          eq(calls.aiOutcome, "solved"),
          isNull(calls.escalatedAt),
          // A solved call never has a ticket; this keeps a stray one from
          // failing the save (tickets.call_id is unique) instead of refusing.
          notExists(tx.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.companyId, companyId), eq(tickets.callId, callId)))),
        ),
      )
      .returning({ id: calls.id });
    if (claimed.length === 0) {
      return undefined;
    }
    const created = await insertTicketWithNextNumber(tx, companyId, ticket, callId, { userId: escalatedByUserId, how: "escalated" });
    return { ticketId: created.id, ticketNumber: created.ticketNumber, assignedToUserId: created.assignedToUserId };
  });
}
