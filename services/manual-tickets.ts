import "server-only";
import { z } from "zod";
import { createManualTicket } from "@/db/ticket-creation";
import type { FormErrors } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { manualTicketSchema } from "@/lib/validation/tickets";
import { notifyAssignee } from "./assignment-notifications";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Tickets a person types in (step 31): a request that reached the team some
// other way (a voicemail on someone's own phone, a customer at the counter, a
// message on social media), or while calls and emails don't reach ansa yet.

// What creating a ticket by hand (or escalating a call) gives back to its form.
export type CreatedTicketResult = { ok: true; ticketNumber: number } | { ok: false; errors: FormErrors };

// Validates and saves a ticket typed in by the logged-in user for their own
// company (channel "manual"), recorded in its history as created by them, and
// routes it like any other new ticket; whoever routing picks is emailed.
// Anyone in the company may do this.
export async function createManualTicketForSession(session: SessionContext, input: unknown): Promise<CreatedTicketResult> {
  const parsed = manualTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("ticket-creations", session.userId, RATE_LIMITS.ticketCreationsPerUser)) {
    return { ok: false, errors: { message: "Too many new tickets. Try again in a few minutes." } };
  }

  const ticket = await createManualTicket(session.companyId, parsed.data, session.userId);
  // After the save, as for every assignment (step 13).
  if (ticket.assignedToUserId) {
    await notifyAssignee({ companyId: session.companyId, ticketId: ticket.id, assigneeUserId: ticket.assignedToUserId, assignedByUserId: null });
  }
  return { ok: true, ticketNumber: ticket.ticketNumber };
}
