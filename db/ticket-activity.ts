import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbTransaction } from "./client";
import { ticketActivity, tickets, users, type TicketActivityKind } from "./schema";

// A ticket's history (step 30): internal notes, and one row for every change.
// Each change is recorded by the function that makes it, in the SAME
// transaction (db/ticket-updates.ts, db/ticket-details.ts,
// db/ticket-solving.ts, db/ticket-reopening.ts, db/routing.ts,
// db/teammate-access.ts and db/unconfirmed-accounts.ts), so a change never
// happens without its row. A ticket a person made in the app (typed in, or
// escalated from a call, step 31) gets its first row from
// db/ticket-creation.ts.

// One change to record. actorUserId null = routing or the app itself did it.
// targetUserId and category: see the columns in db/schema/ticket-activity.ts.
export type TicketChange = {
  ticketId: string;
  kind: Exclude<TicketActivityKind, "note">;
  actorUserId: string | null;
  targetUserId?: string | null;
  category?: string | null;
};

export type NoteToAdd = {
  // Made by the caller before encrypting: the encryption context names it.
  noteId: string;
  // Only a claim (it comes from a form): checked inside the INSERT.
  ticketId: string;
  authorUserId: string;
  bodyEncrypted: string;
};

export type TicketActivityRow = {
  id: string;
  kind: TicketActivityKind;
  actorUserId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  category: string | null;
  bodyEncrypted: string | null;
  createdAt: Date;
};

// Two views of the users table: who did it, and who it was about. Both joins
// also match company_id, so a name from another company can never show up.
const actor = alias(users, "actor");
const target = alias(users, "target");

// Records one change to one company's ticket, inside the transaction that made it.
export async function recordTicketChange(tx: DbTransaction, companyId: string, change: TicketChange): Promise<void> {
  await recordTicketChanges(tx, companyId, [change]);
}

// Records changes to one company's tickets (one row each), inside the
// transaction that made them. Every column is named: nothing in `change` can
// write a company, a note or a time.
export async function recordTicketChanges(tx: DbTransaction, companyId: string, changes: TicketChange[]): Promise<void> {
  if (changes.length === 0) {
    return;
  }
  const rows = changes.map((change) => ({
    companyId,
    ticketId: change.ticketId,
    kind: change.kind,
    actorUserId: change.actorUserId,
    targetUserId: change.targetUserId ?? null,
    category: change.category ?? null,
  }));
  await tx.insert(ticketActivity).values(rows);
}

// Adds an internal note to one company's ticket. ONE statement, INSERT ...
// SELECT: the row is only written when the ticket is this company's, so a
// ticket id from another company inserts nothing (false). Drizzle needs every
// column, in the table's order; the casts tell Postgres each value's type.
export async function addTicketNote(companyId: string, note: NoteToAdd): Promise<boolean> {
  const noteOnThisCompanysTicket = db
    .select({
      id: sql<string>`${note.noteId}::uuid`.as("id"),
      companyId: tickets.companyId,
      ticketId: tickets.id,
      kind: sql<TicketActivityKind>`'note'::ticket_activity_kind`.as("kind"),
      actorUserId: sql<string>`${note.authorUserId}::text`.as("actor_user_id"),
      targetUserId: sql<string | null>`null::text`.as("target_user_id"),
      category: sql<string | null>`null::text`.as("category"),
      bodyEncrypted: sql<string>`${note.bodyEncrypted}::text`.as("body_encrypted"),
      createdAt: sql<Date>`clock_timestamp()`.as("created_at"),
    })
    .from(tickets)
    .where(and(eq(tickets.id, note.ticketId), eq(tickets.companyId, companyId)));
  const added = await db
    .insert(ticketActivity)
    .select(noteOnThisCompanysTicket)
    .returning({ id: ticketActivity.id });
  return added.length > 0;
}

// Takes an account that is about to be deleted out of one company's ticket
// history: rows that named it as the person taken off a ticket stay, without
// the name. Only for db/unconfirmed-accounts.ts: an account that never
// confirmed has no identity worth keeping, and a row pointing at it would stop
// the delete (a ticket left on such an account from before step 23 may have
// been unassigned since). The only change ever made to a history row.
export async function clearDeletedAccountFromHistory(tx: DbTransaction, companyId: string, userId: string): Promise<void> {
  await tx
    .update(ticketActivity)
    .set({ targetUserId: null })
    .where(and(eq(ticketActivity.companyId, companyId), eq(ticketActivity.targetUserId, userId)));
}

// Lists the newest history entries of one company's ticket, newest first, at
// most `limit` of them, with the names of who did it and who it was about.
export async function getTicketActivity(companyId: string, ticketId: string, limit: number): Promise<TicketActivityRow[]> {
  return db
    .select({
      id: ticketActivity.id,
      kind: ticketActivity.kind,
      actorUserId: ticketActivity.actorUserId,
      actorName: actor.name,
      targetUserId: ticketActivity.targetUserId,
      targetName: target.name,
      category: ticketActivity.category,
      bodyEncrypted: ticketActivity.bodyEncrypted,
      createdAt: ticketActivity.createdAt,
    })
    .from(ticketActivity)
    .leftJoin(actor, and(eq(actor.id, ticketActivity.actorUserId), eq(actor.companyId, ticketActivity.companyId)))
    .leftJoin(target, and(eq(target.id, ticketActivity.targetUserId), eq(target.companyId, ticketActivity.companyId)))
    .where(and(eq(ticketActivity.companyId, companyId), eq(ticketActivity.ticketId, ticketId)))
    .orderBy(desc(ticketActivity.createdAt), desc(ticketActivity.id))
    .limit(limit);
}
