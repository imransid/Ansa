import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";
import { tickets } from "./tickets";

// What one history entry records (step 30). "note" is an internal note; every
// other kind is a change to the ticket, written by the code that makes it.
export const ticketActivityKinds = [
  "note",
  "assigned",
  "unassigned",
  "routed",
  "solved",
  "closed_without_email",
  "reopened",
  "category_set",
  "customer_email_set",
  // Step 31: a person typed the ticket in ("created") or escalated a call the
  // AI marked solved ("escalated"), and later changed its subject or the
  // customer's name. Who and when only: the old and new text stay out of the
  // history, like the customer email.
  "created",
  "escalated",
  "subject_changed",
  "customer_name_changed",
] as const;
export const ticketActivityKindEnum = pgEnum("ticket_activity_kind", ticketActivityKinds);
export type TicketActivityKind = (typeof ticketActivityKinds)[number];

// A ticket's history: internal notes and who changed what, and when. Rows are
// only ever added, never deleted, and changed in one case only: an account
// that never confirmed is deleted (clearDeletedAccountFromHistory in
// db/ticket-activity.ts).
export const ticketActivity = pgTable(
  "ticket_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id").notNull(),
    kind: ticketActivityKindEnum("kind").notNull(),
    // Who did it: a note's author, or the person who made the change. Empty =
    // routing or the app itself (taking tickets off someone removed from the team).
    actorUserId: text("actor_user_id"),
    // Who it was about: the new assignee (assigned, routed) or the person taken
    // off the ticket (unassigned). Empty for the other kinds, and for an
    // account that was deleted (never confirmed, see db/unconfirmed-accounts.ts).
    targetUserId: text("target_user_id"),
    // category_set: the new category (empty = removed). routed: the category
    // routing followed, empty when it followed the same customer's other open
    // ticket instead (step 29). A copy of the name at that moment, so the
    // history keeps what routing did then, even after the category changes.
    category: text("category"),
    // Notes only: the text, encrypted (lib/encryption.ts, ticketNoteContext).
    bodyEncrypted: text("body_encrypted"),
    // clock_timestamp(), not now(): now() is the same for every row of one
    // transaction, and a category change and the routing it causes must keep
    // their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // Postgres refuses a history row on another company's ticket, or naming
    // someone from another company (same idea as the tickets table).
    foreignKey({
      name: "ticket_activity_ticket_in_same_company_fk",
      columns: [table.companyId, table.ticketId],
      foreignColumns: [tickets.companyId, tickets.id],
    }),
    foreignKey({
      name: "ticket_activity_actor_in_same_company_fk",
      columns: [table.companyId, table.actorUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "ticket_activity_target_in_same_company_fk",
      columns: [table.companyId, table.targetUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // Encrypted text exists exactly on notes, and every note has an author.
    check("ticket_activity_body_only_on_notes", sql`(${table.kind} = 'note') = (${table.bodyEncrypted} IS NOT NULL)`),
    check("ticket_activity_note_has_author", sql`${table.kind} <> 'note' OR ${table.actorUserId} IS NOT NULL`),
    // The ticket page reads one ticket's newest entries.
    index("ticket_activity_company_id_ticket_id_created_at_idx").on(table.companyId, table.ticketId, table.createdAt),
  ],
);
