import "server-only";
import { randomUUID } from "node:crypto";
import { getAssignmentNotice } from "@/db/assignment-notices";
import { renderTicketAssignedEmail } from "@/lib/emails/ticket-assigned";
import { env } from "@/lib/env";
import { buildFromHeader, sendEmail } from "@/lib/send-email";

type AssignmentEvent = {
  companyId: string;
  ticketId: string;
  assigneeUserId: string;
  // The person who assigned it, or null when routing did.
  assignedByUserId: string | null;
};

// Emails a person that a ticket is now theirs (step 13). Called AFTER the
// assignment is saved. Best effort: a failure is logged (fixed text only) and
// never undoes or blocks the assignment. Nobody is emailed about assigning a
// ticket to themselves.
export async function notifyAssignee(event: AssignmentEvent): Promise<void> {
  if (event.assignedByUserId === event.assigneeUserId) {
    return;
  }
  try {
    const notice = await getAssignmentNotice(event.companyId, event.ticketId, event.assigneeUserId);
    if (!notice) {
      return;
    }
    const content = renderTicketAssignedEmail({
      assigneeName: notice.assigneeName,
      ticketNumber: notice.ticketNumber,
      ticketSubject: notice.ticketSubject,
      category: notice.category,
      assignedAutomatically: notice.assignedAutomatically,
      link: `${env.BETTER_AUTH_URL}/tickets/${notice.ticketNumber}`,
    });
    const result = await sendEmail({
      from: buildFromHeader(notice.companyName),
      to: notice.assigneeEmail,
      replyTo: null,
      ...content,
      idempotencyKey: `ticket-assigned-${event.ticketId}-${randomUUID()}`,
    });
    if (!result.ok) {
      console.error("Could not send an assignment email");
    }
  } catch (error) {
    // Never log the address, the subject or an error message.
    console.error(`Assignment email failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
  }
}
