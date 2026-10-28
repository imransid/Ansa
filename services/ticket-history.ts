import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { addTicketNote, getTicketActivity, type TicketActivityRow } from "@/db/ticket-activity";
import type { TicketActivityKind } from "@/db/schema";
import { decryptForDisplay, encryptText } from "@/lib/encryption";
import { ticketNoteContext } from "@/lib/encryption-contexts";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { ticketNoteSchema } from "@/lib/validation/tickets";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// A ticket's notes and history (step 30). Notes are internal: written by the
// team for the team, never emailed to anyone, never logged.

// How many of a ticket's newest entries the ticket page shows. Notes are
// limited per person (ticket-changes), not per ticket, so a page must stop somewhere.
export const HISTORY_LIMIT = 200;

export type TicketHistoryEntry = {
  id: string;
  kind: TicketActivityKind;
  actorUserId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  category: string | null;
  // Notes only: the text, or null when it can't be decrypted (noteUnreadable).
  noteText: string | null;
  noteUnreadable: boolean;
  createdAt: Date;
};

export type TicketHistory = {
  // Oldest first, as the page reads them.
  entries: TicketHistoryEntry[];
  // The ticket has more, older entries than HISTORY_LIMIT; they are not shown.
  olderEntriesHidden: boolean;
};

// Adds an internal note to a ticket of the session's company, written by the
// logged-in user. The text is encrypted before it is stored. The ticket id
// from the form is only a claim: the note is saved only if that ticket is
// this company's.
export async function addTicketNoteForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = ticketNoteSchema.safeParse(input);
  if (!parsed.success) {
    return noteInputErrors(parsed.error);
  }
  if (await isOverRateLimit("ticket-changes", session.userId, RATE_LIMITS.ticketChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }

  const { ticketId, body } = parsed.data;
  const noteId = randomUUID();
  const added = await addTicketNote(session.companyId, {
    noteId,
    ticketId,
    authorUserId: session.userId,
    bodyEncrypted: encryptText(body, ticketNoteContext(session.companyId, ticketId, noteId)),
  });
  if (!added) {
    return { ok: false, errors: { message: "That ticket was not found in your company." } };
  }
  return { ok: true };
}

// Lists the newest entries of a ticket of the session's company, oldest first
// for reading, with notes decrypted for the teammate reading the ticket.
export async function getTicketHistoryForSession(session: SessionContext, ticketId: string): Promise<TicketHistory> {
  // One more than shown, to know whether older entries are left out.
  const newestFirst = await getTicketActivity(session.companyId, ticketId, HISTORY_LIMIT + 1);
  const shown = newestFirst.slice(0, HISTORY_LIMIT).reverse();
  return {
    entries: shown.map((row) => toHistoryEntry(session.companyId, ticketId, row)),
    olderEntriesHidden: newestFirst.length > HISTORY_LIMIT,
  };
}

// The note's text problems go under the box; a bad ticket id (only a changed
// form sends one) gets a plain message.
function noteInputErrors(error: z.ZodError<z.output<typeof ticketNoteSchema>>): FormResult {
  const bodyErrors = z.flattenError(error).fieldErrors.body;
  if (bodyErrors) {
    return { ok: false, errors: { fieldErrors: { body: bodyErrors } } };
  }
  return { ok: false, errors: { message: "Unknown ticket." } };
}

// Every field named: the ciphertext never leaves this service.
function toHistoryEntry(companyId: string, ticketId: string, row: TicketActivityRow): TicketHistoryEntry {
  const note = row.kind === "note" ? decryptForDisplay(row.bodyEncrypted, ticketNoteContext(companyId, ticketId, row.id)) : null;
  return {
    id: row.id,
    kind: row.kind,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    targetUserId: row.targetUserId,
    targetName: row.targetName,
    category: row.category,
    noteText: note?.text ?? null,
    noteUnreadable: note?.unreadable ?? false,
    createdAt: row.createdAt,
  };
}
