import "server-only";
import { reopenTicket } from "@/db/ticket-reopening";
import { markTicketSolvedAndQueueEmail, markTicketSolvedWithoutEmail } from "@/db/ticket-solving";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { solveTicketSchema, ticketIdSchema } from "@/lib/validation/tickets";
import { notifyAssignee } from "./assignment-notifications";
import { deliverOutgoingEmail } from "./customer-emails";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Closing and reopening tickets: "Mark as solved" (emails the customer),
// "Close without emailing", and reopen (owners only). Each one is recorded in
// the ticket's history with who did it (db/ticket-activity.ts), so a reopen
// never erases who solved it before.

// Marks an open ticket of the session's company as solved by the logged-in
// user, then emails the customer if the ticket has an address. Anyone in the
// company may do this. The ticket must still have exactly the address the
// person confirmed on the page (none, if the page showed none).
export async function markTicketSolvedForSession(
  session: SessionContext,
  input: unknown,
): Promise<FormResult> {
  const parsed = solveTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown ticket." } };
  }
  if (await isOverTicketChangeLimit(session)) {
    return tooManyChanges();
  }

  const { ticketId, confirmedCustomerEmail } = parsed.data;
  const { solved, queuedEmailId } = await markTicketSolvedAndQueueEmail(
    session.companyId,
    ticketId,
    session.userId,
    confirmedCustomerEmail,
  );
  if (!solved) {
    return {
      ok: false,
      errors: { message: "Nothing was done: this ticket is already solved, or its customer email just changed. Check the ticket and try again." },
    };
  }

  // The ticket is solved either way. If delivery fails, or the company's daily
  // limit holds the email back, the ticket page says so next to a Retry button
  // (CustomerEmailStatus), so nothing is lost. That line is read from the
  // email row, so it goes away once a Retry sends it; a message returned here
  // would stay on screen after that.
  if (queuedEmailId) {
    await deliverOutgoingEmail(session.companyId, queuedEmailId);
  }
  return { ok: true };
}

// Closes an open ticket of the session's company as solved WITHOUT emailing
// the customer (spam, a "thanks" reply, a duplicate). Anyone in the company may do this.
export async function closeTicketWithoutEmailForSession(
  session: SessionContext,
  input: unknown,
): Promise<FormResult> {
  const parsed = ticketIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown ticket." } };
  }
  if (await isOverTicketChangeLimit(session)) {
    return tooManyChanges();
  }

  const closed = await markTicketSolvedWithoutEmail(session.companyId, parsed.data.ticketId, session.userId);
  if (!closed) {
    return { ok: false, errors: { message: "This ticket is already solved or was not found." } };
  }
  return { ok: true };
}

// Reopens a solved ticket of the session's company. Owners only. If its
// assignee was removed from the team, routing gives it to someone else, who
// is emailed (step 13).
export async function reopenTicketForSession(
  session: SessionContext,
  input: unknown,
): Promise<FormResult> {
  if (session.role !== "owner") {
    return { ok: false, errors: { message: "Only owners can reopen tickets." } };
  }
  const parsed = ticketIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown ticket." } };
  }
  if (await isOverTicketChangeLimit(session)) {
    return tooManyChanges();
  }

  const { reopened, routedTo } = await reopenTicket(session.companyId, parsed.data.ticketId, session.userId);
  if (!reopened) {
    return { ok: false, errors: { message: "This ticket is not solved or was not found." } };
  }
  if (routedTo) {
    await notifyAssignee({ companyId: session.companyId, ticketId: parsed.data.ticketId, assigneeUserId: routedTo, assignedByUserId: null });
  }
  return { ok: true };
}

// The same counter as every other ticket change (services/tickets.ts).
function isOverTicketChangeLimit(session: SessionContext): Promise<boolean> {
  return isOverRateLimit("ticket-changes", session.userId, RATE_LIMITS.ticketChangesPerUser);
}

// The answer when the ticket-changes limit refused the change.
function tooManyChanges(): FormResult {
  return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
}
