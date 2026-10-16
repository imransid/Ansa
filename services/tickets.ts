import "server-only";
import { z } from "zod";
import { assignTicket, markTicketSolvedAndQueueEmail, reopenTicket } from "@/db/ticket-updates";
import {
  createTicket,
  getTicketByNumber,
  getTicketCountsForCompany,
  getTicketsForCompany,
  type Ticket,
  type TicketCounts,
  type TicketDetail,
  type TicketListItem,
} from "@/db/tickets";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import {
  assignTicketSchema,
  newTicketSchema,
  ticketIdSchema,
  ticketNumberSchema,
} from "@/lib/validation/tickets";
import { deliverOutgoingEmail } from "./customer-emails";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Re-exported so pages can use the types without importing from /db.
export type { TicketCounts, TicketDetail, TicketListItem };

// Lists the newest tickets of the logged-in user's company.
export async function listTicketsForSession(
  session: SessionContext,
): Promise<TicketListItem[]> {
  return getTicketsForCompany(session.companyId);
}

// Counts open and solved tickets of the logged-in user's company.
export async function getTicketCountsForSession(
  session: SessionContext,
): Promise<TicketCounts> {
  return getTicketCountsForCompany(session.companyId);
}

// Reads one ticket of the session's company by its number from the URL.
// Returns null for bad numbers and for numbers that don't exist in this company.
export async function getTicketForSession(
  session: SessionContext,
  ticketNumber: unknown,
): Promise<TicketDetail | null> {
  const parsed = ticketNumberSchema.safeParse(ticketNumber);
  if (!parsed.success) {
    return null;
  }
  const ticket = await getTicketByNumber(session.companyId, parsed.data);
  return ticket ?? null;
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

// Assigns a ticket to someone in the session's company, or unassigns it.
// Anyone in the company may do this.
export async function assignTicketForSession(
  session: SessionContext,
  input: unknown,
): Promise<FormResult> {
  const parsed = assignTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverTicketChangeLimit(session)) {
    return tooManyChanges();
  }

  const { ticketId, assigneeUserId } = parsed.data;
  const wasAssigned = await assignTicket(session.companyId, ticketId, assigneeUserId);
  if (!wasAssigned) {
    return { ok: false, errors: { message: "That ticket or teammate was not found in your company." } };
  }
  return { ok: true };
}

// Marks an open ticket of the session's company as solved by the logged-in user,
// then emails the customer if they have an email address. Anyone in the company may do this.
export async function markTicketSolvedForSession(
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

  const { solved, queuedEmailId } = await markTicketSolvedAndQueueEmail(
    session.companyId,
    parsed.data.ticketId,
    session.userId,
  );
  if (!solved) {
    return { ok: false, errors: { message: "This ticket is already solved or was not found." } };
  }

  // The ticket is solved either way. If delivery fails, the ticket page shows
  // "Email failed" with a Retry button, so nothing is lost.
  if (queuedEmailId) {
    await deliverOutgoingEmail(session.companyId, queuedEmailId);
  }
  return { ok: true };
}

// Reopens a solved ticket of the session's company. Owners only.
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

  const wasReopened = await reopenTicket(session.companyId, parsed.data.ticketId);
  if (!wasReopened) {
    return { ok: false, errors: { message: "This ticket is not solved or was not found." } };
  }
  return { ok: true };
}

function isOverTicketChangeLimit(session: SessionContext): Promise<boolean> {
  return isOverRateLimit("ticket-changes", session.userId, RATE_LIMITS.ticketChangesPerUser);
}

function tooManyChanges(): FormResult {
  return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
}
