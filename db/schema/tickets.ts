import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
    // Used in step 4 to route tickets to the right expert. Nothing sets it yet.
    category: text("category"),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Also serves as the index for "this company's tickets, newest first".
  (table) => [
    unique("tickets_company_id_ticket_number_unique").on(
      table.companyId,
      table.ticketNumber,
    ),
  ],
);
