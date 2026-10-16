import "server-only";
import {
  createTicket,
  getTicketsForCompany,
  type Ticket,
  type TicketListItem,
} from "@/db/tickets";
import type { SessionContext } from "@/lib/session";
import { newTicketSchema } from "@/lib/validation/tickets";

// Re-exported so pages can use the type without importing from /db.
export type { TicketListItem };

// Lists the newest tickets of the logged-in user's company.
export async function listTicketsForSession(
  session: SessionContext,
): Promise<TicketListItem[]> {
  return getTicketsForCompany(session.companyId);
}

// Validates and saves a new ticket for one company. Throws if the input is invalid.
// companyId must come from a trusted server-side source (a session, or later a
// verified webhook), never from the request body.
export async function createTicketForCompany(
  companyId: string,
  input: unknown,
): Promise<Ticket> {
  const validInput = newTicketSchema.parse(input);
  return createTicket(companyId, validInput);
}
