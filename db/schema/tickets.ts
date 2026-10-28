import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { calls } from "./calls";
import { categories } from "./categories";
import { companies } from "./companies";

export const ticketStatuses = ["open", "solved"] as const;
export const ticketStatusEnum = pgEnum("ticket_status", ticketStatuses);
export type TicketStatus = (typeof ticketStatuses)[number];

// "manual" = typed in by a person in ansa (step 31): a voicemail left on
// someone's own phone, a customer at the counter, a message on social media.
export const ticketChannels = ["phone", "email", "manual"] as const;
export const ticketChannelEnum = pgEnum("ticket_channel", ticketChannels);
export type TicketChannel = (typeof ticketChannels)[number];

// A problem the AI could not solve, waiting for a human expert.
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Human-friendly number, counted per company: #1, #2, ...
    // Handed out by createTicket in db/ticket-creation.ts, never chosen by the caller.
    ticketNumber: integer("ticket_number").notNull(),
    subject: text("subject").notNull(),
    // Call or email notes: what the customer needs and what the AI already tried.
    description: text("description").notNull(),
    status: ticketStatusEnum("status").notNull().default("open"),
    channel: ticketChannelEnum("channel").notNull(),
    // The category's name (see categories.ts). Decides who the ticket is
    // routed to (db/routing.ts). Renaming a category updates this too.
    category: text("category"),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    // Who typed the customer's email into the ticket, and when (step 9).
    // Both empty = the email came with the ticket (or there is none).
    customerEmailSetByUserId: text("customer_email_set_by_user_id"),
    customerEmailSetAt: timestamp("customer_email_set_at", { withTimezone: true }),
    customerPhone: text("customer_phone"),
    // The expert working on it. Empty = unassigned.
    assignedToUserId: text("assigned_to_user_id"),
    // How the CURRENT assignment happened: true = routed (by category, or to
    // whoever has the same customer's other open ticket, step 29), false = a
    // person picked the assignee, empty = unassigned.
    assignedAutomatically: boolean("assigned_automatically"),
    // Who routing picked, set once and never overwritten, even if a person
    // reassigns later. Compare with the assignee / solver to see how often
    // routing picks the right expert. Both rules land here; which one made the
    // pick is in the ticket's history ("routed" rows of ticket_activity: a
    // category, or none for the same customer's other open ticket, step 30).
    routedToUserId: text("routed_to_user_id"),
    // Both set when the ticket is solved, both cleared when it is reopened.
    solvedAt: timestamp("solved_at", { withTimezone: true }),
    solvedByUserId: text("solved_by_user_id"),
    // True when someone chose "Close without emailing" (spam, a "thanks"
    // reply, a duplicate): solved, and on purpose no email to the customer.
    // Cleared when the ticket is reopened.
    solvedWithoutEmail: boolean("solved_without_email").notNull().default(false),
    // The phone call this ticket was created from (step 8), if any. Unique: a
    // call gets at most one ticket. The transcript stays on the call, encrypted.
    callId: uuid("call_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Also serves as the index for "this company's tickets, newest first".
    unique("tickets_company_id_ticket_number_unique").on(
      table.companyId,
      table.ticketNumber,
    ),
    // id is already unique. This pair lets other tables use a (company_id,
    // ticket_id) foreign key, same idea as users_company_id_id_unique.
    unique("tickets_company_id_id_unique").on(table.companyId, table.id),
    // Safety net under the app's own checks: Postgres refuses any assignee or
    // solver who is not in the ticket's company. When the user column is empty
    // (unassigned, not solved) Postgres skips the check.
    foreignKey({
      name: "tickets_assignee_in_same_company_fk",
      columns: [table.companyId, table.assignedToUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "tickets_solver_in_same_company_fk",
      columns: [table.companyId, table.solvedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // Postgres refuses a "set by" user from another company.
    foreignKey({
      name: "tickets_email_setter_in_same_company_fk",
      columns: [table.companyId, table.customerEmailSetByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // "Set by" and "set at" are always filled in together, or not at all.
    check(
      "tickets_email_setter_fields_together",
      sql`(${table.customerEmailSetByUserId} IS NULL) = (${table.customerEmailSetAt} IS NULL)`,
    ),
    foreignKey({
      name: "tickets_routed_to_in_same_company_fk",
      columns: [table.companyId, table.routedToUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // The category must be one of this company's categories. ON UPDATE CASCADE:
    // renaming a category renames it on every ticket.
    foreignKey({
      name: "tickets_category_in_same_company_fk",
      columns: [table.companyId, table.category],
      foreignColumns: [categories.companyId, categories.name],
    }).onUpdate("cascade"),
    // Assigned exactly when we know how it was assigned.
    check(
      "tickets_assignment_origin_matches_assignee",
      sql`(${table.assignedToUserId} IS NULL) = (${table.assignedAutomatically} IS NULL)`,
    ),
    // Postgres refuses a ticket linked to another company's call.
    foreignKey({
      name: "tickets_call_in_same_company_fk",
      columns: [table.companyId, table.callId],
      foreignColumns: [calls.companyId, calls.id],
    }),
    // A ticket is solved exactly when it has both a solved time and a solver.
    check(
      "tickets_solved_fields_match_status",
      sql`(${table.status} = 'solved') = (${table.solvedAt} IS NOT NULL AND ${table.solvedByUserId} IS NOT NULL)`,
    ),
    // Only a solved ticket can have been closed without emailing.
    check(
      "tickets_solved_without_email_only_when_solved",
      sql`NOT ${table.solvedWithoutEmail} OR ${table.status} = 'solved'`,
    ),
    // Two indexes over OPEN tickets only (a small part of a company's
    // tickets once it has been running a while), so these never read the
    // solved ones. By assignee: routing counts each expert's open tickets
    // while it holds the company's lock (db/routing.ts), "Mine" and
    // "Unassigned" list them newest first, and removing someone finds theirs.
    index("tickets_open_company_id_assignee_idx")
      .on(table.companyId, table.assignedToUserId, table.ticketNumber)
      .where(sql`${table.status} = 'open'`),
    // By number: the "Open" view, and the same-customer lookup that runs for
    // every new ticket inside the company's lock (db/same-customer.ts).
    index("tickets_open_company_id_ticket_number_idx")
      .on(table.companyId, table.ticketNumber)
      .where(sql`${table.status} = 'open'`),
  ],
);
