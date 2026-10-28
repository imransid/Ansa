import "server-only";
import { z } from "zod";
import { getOtherOpenTicketsFromSameCustomer, type SameCustomerTicket } from "@/db/same-customer";
import { createTicket } from "@/db/ticket-creation";
import { editTicketDetails } from "@/db/ticket-details";
import { assignTicket, setTicketCustomerEmail } from "@/db/ticket-updates";
import {
  countTicketsPerView,
  getTicketByNumber,
  getTicketsForCompany,
  type Ticket,
  type TicketDetail,
  type TicketListItem,
  type TicketViewCounts,
} from "@/db/tickets";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import type { TicketListQuery } from "@/lib/validation/list-queries";
import {
  assignTicketSchema,
  editTicketDetailsSchema,
  newTicketSchema,
  setCustomerEmailSchema,
  ticketNumberSchema,
} from "@/lib/validation/tickets";
import { notifyAssignee } from "./assignment-notifications";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Re-exported so pages can use the types without importing from /db.
export type { SameCustomerTicket, TicketDetail, TicketListItem, TicketViewCounts };

// Every ticket, unfiltered: what the checks and older callers list.
const EVERY_TICKET: TicketListQuery = { view: "all", search: null };

// Solving, closing without emailing and reopening are in services/ticket-status.ts,
// notes and history in services/ticket-history.ts, tickets typed in by a
// person in services/manual-tickets.ts.

// Lists one page of the logged-in user's company's tickets in one view, with
// an optional search, newest first (step 29). "mine" always means the
// session's own user: the filter is built here, field by field, so nothing
// from the URL can name another person.
export async function listTicketsForSession(
  session: SessionContext,
  page = 1,
  query: TicketListQuery = EVERY_TICKET,
): Promise<TicketListItem[]> {
  const filter = { view: query.view, search: query.search, viewerUserId: session.userId };
  return getTicketsForCompany(session.companyId, filter, page);
}

// Counts the logged-in user's company's tickets in every view, with the same
// search, for the view links ("Unassigned (3)") and "Page x of y".
export async function countTicketsPerViewForSession(
  session: SessionContext,
  search: string | null = null,
): Promise<TicketViewCounts> {
  return countTicketsPerView(session.companyId, session.userId, search);
}

// Lists the session company's other open tickets from the same customer as
// this ticket (same phone number or email), for the ticket page (step 29).
export async function listOtherOpenTicketsFromCustomerForSession(
  session: SessionContext,
  ticketId: string,
): Promise<SameCustomerTicket[]> {
  return getOtherOpenTicketsFromSameCustomer(session.companyId, ticketId);
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
// companyId must come from a trusted server-side source, never from the
// request body. Only scripts call this (the seed and the checks); people use
// createManualTicketForSession (services/manual-tickets.ts).
export async function createTicketForCompany(
  companyId: string,
  input: unknown,
): Promise<Ticket> {
  const validInput = newTicketSchema.parse(input);
  const ticket = await createTicket(companyId, validInput);
  // Routing gave it to someone: tell them (step 13).
  if (ticket.assignedToUserId) {
    await notifyAssignee({ companyId, ticketId: ticket.id, assigneeUserId: ticket.assignedToUserId, assignedByUserId: null });
  }
  return ticket;
}

// Assigns a ticket to someone in the session's company, or unassigns it, and
// records who did it in the ticket's history. Anyone in the company may do
// this, to anyone who can take tickets (confirmed their email, not removed
// from the team). Saving the assignee the ticket already has changes nothing:
// a routed ticket stays "routed", and nobody is emailed again.
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
  const outcome = await assignTicket(session.companyId, ticketId, assigneeUserId, session.userId);
  if (outcome === "refused") {
    return {
      ok: false,
      errors: { message: "That ticket was not found, or that person can't take tickets (removed, or not confirmed yet)." },
    };
  }
  if (outcome === "changed" && assigneeUserId) {
    await notifyAssignee({ companyId: session.companyId, ticketId, assigneeUserId, assignedByUserId: session.userId });
  }
  return { ok: true };
}

// Sets or changes the customer's email on a ticket of the session's company,
// recording who did it (on the ticket and in its history). Anyone in the
// company may do this. Only future solves use the new address: nothing is sent
// now, and queued emails keep theirs.
export async function setCustomerEmailForSession(
  session: SessionContext,
  input: unknown,
): Promise<FormResult> {
  const parsed = setCustomerEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverTicketChangeLimit(session)) {
    return tooManyChanges();
  }

  const { ticketId, customerEmail } = parsed.data;
  const wasSet = await setTicketCustomerEmail(session.companyId, ticketId, customerEmail, session.userId);
  if (!wasSet) {
    return { ok: false, errors: { message: "That ticket was not found in your company." } };
  }
  return { ok: true };
}

// Changes the subject and/or the customer's name of a ticket of the session's
// company (step 31), with the same rules as a new ticket, and records in its
// history who changed which. Anyone in the company may do this. Only the
// fields the person changed in the editor are saved, so a teammate's change
// to the other one, made meanwhile, stays. Saving what the ticket already has
// changes nothing.
export async function editTicketDetailsForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = editTicketDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverTicketChangeLimit(session)) {
    return tooManyChanges();
  }

  const { ticketId, subject, customerName, originalSubject, originalCustomerName } = parsed.data;
  const edit = {
    openedWith: { subject: originalSubject, customerName: originalCustomerName },
    saved: { subject, customerName },
  };
  const outcome = await editTicketDetails(session.companyId, ticketId, edit, session.userId);
  if (outcome === "refused") {
    return { ok: false, errors: { message: "That ticket was not found in your company." } };
  }
  return { ok: true };
}

// Counts one ticket change for this person and says whether it is one too many.
function isOverTicketChangeLimit(session: SessionContext): Promise<boolean> {
  return isOverRateLimit("ticket-changes", session.userId, RATE_LIMITS.ticketChangesPerUser);
}

// The answer when the ticket-changes limit refused the change.
function tooManyChanges(): FormResult {
  return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
}
