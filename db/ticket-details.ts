import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { tickets } from "./schema";
import { recordTicketChanges, type TicketChange } from "./ticket-activity";
import type { TicketChangeOutcome } from "./ticket-updates";

// "Edit" on the ticket page (step 31): the subject and the customer's name.
// The AI writes the first subject for a call or an email, and a phone ticket
// starts without a name; the team corrects them as they learn more.

export type TicketDetails = {
  subject: string;
  customerName: string | null;
};

// One save from the editor: what it showed when it opened, and what the
// person saved. openedWith comes from the form too, so it is only used to
// tell which fields the person changed; who may edit is decided by companyId.
export type TicketDetailsEdit = {
  openedWith: TicketDetails;
  saved: TicketDetails;
};

// Saves the fields a person changed in the editor on one company's ticket,
// and records one history row for each, with who did it (actorUserId, the
// session's own user). A field left as the editor showed it is not written:
// a teammate may have changed it while the editor was open, and that change
// must stay, not be undone and recorded as this person's. A changed field the
// ticket already holds writes nothing; nothing to write = "unchanged". A
// ticket of another company is "refused". The ticket row is locked while
// comparing, so the comparison can't go stale before the UPDATE.
export async function editTicketDetails(
  companyId: string,
  ticketId: string,
  edit: TicketDetailsEdit,
  actorUserId: string,
): Promise<TicketChangeOutcome> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ subject: tickets.subject, customerName: tickets.customerName })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
      .for("no key update");
    if (!current) {
      return "refused";
    }
    const newValues = fieldsToWrite(current, edit);
    const changes = describeChanges(ticketId, newValues, actorUserId);
    if (changes.length === 0) {
      return "unchanged";
    }
    await tx
      .update(tickets)
      .set(newValues)
      .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)));
    await recordTicketChanges(tx, companyId, changes);
    return "changed";
  });
}

// Built field by field, so only the subject and the customer name can be in
// it. A field goes in only when the person changed it in the editor and the
// ticket doesn't already hold the new value.
function fieldsToWrite(current: TicketDetails, edit: TicketDetailsEdit): Partial<TicketDetails> {
  const { openedWith, saved } = edit;
  const newValues: Partial<TicketDetails> = {};
  if (saved.subject !== openedWith.subject && saved.subject !== current.subject) {
    newValues.subject = saved.subject;
  }
  if (saved.customerName !== openedWith.customerName && saved.customerName !== current.customerName) {
    newValues.customerName = saved.customerName;
  }
  return newValues;
}

// One history row per field written. The old and new text stay out of the
// history, like the customer email: only who changed it, and when.
function describeChanges(ticketId: string, newValues: Partial<TicketDetails>, actorUserId: string): TicketChange[] {
  const changes: TicketChange[] = [];
  if ("subject" in newValues) {
    changes.push({ ticketId, kind: "subject_changed", actorUserId });
  }
  // "in", not a value test: null (the name cleared) is a change too.
  if ("customerName" in newValues) {
    changes.push({ ticketId, kind: "customer_name_changed", actorUserId });
  }
  return changes;
}
