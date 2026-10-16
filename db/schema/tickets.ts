import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
import { companies } from "./companies";

export const ticketStatuses = ["open", "solved"] as const;
export const ticketStatusEnum = pgEnum("ticket_status", ticketStatuses);
export type TicketStatus = (typeof ticketStatuses)[number];

export const ticketChannels = ["phone", "email"] as const;
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
    // Handed out by createTicket in db/tickets.ts, never chosen by the caller.
    ticketNumber: integer("ticket_number").notNull(),
    subject: text("subject").notNull(),
    // Call or email notes: what the customer needs and what the AI already tried.
    description: text("description").notNull(),
    status: ticketStatusEnum("status").notNull().default("open"),
    channel: ticketChannelEnum("channel").notNull(),
    // Used later to route tickets to the right expert. Nothing sets it yet.
    category: text("category"),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    // The expert working on it. Empty = unassigned.
    assignedToUserId: text("assigned_to_user_id"),
    // Both set when the ticket is solved, both cleared when it is reopened.
    solvedAt: timestamp("solved_at", { withTimezone: true }),
    solvedByUserId: text("solved_by_user_id"),
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
  ],
);
