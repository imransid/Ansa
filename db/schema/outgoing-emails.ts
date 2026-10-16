import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { tickets } from "./tickets";

export const emailKinds = ["ticket_solved"] as const;
export const emailKindEnum = pgEnum("email_kind", emailKinds);

export const emailStatuses = ["pending", "sent", "failed"] as const;
export const emailStatusEnum = pgEnum("email_status", emailStatuses);
export type EmailStatus = (typeof emailStatuses)[number];

// Every email we send to a customer. A row is written in the same database
// transaction as the change that causes it (for example marking a ticket
// solved), so an email can never be silently forgotten. Delivery happens right
// after; a failed delivery stays visible here and can be retried.
export const outgoingEmails = pgTable(
  "outgoing_emails",
  {
    // Also used as the delivery idempotency key, so retries never send twice.
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id").notNull(),
    kind: emailKindEnum("kind").notNull(),
    // Copied from the ticket when the email is queued.
    toEmail: text("to_email").notNull(),
    status: emailStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    // Short error from the last failed attempt. Never contains API keys.
    lastError: text("last_error"),
    // Resend's email id, or "dev-outbox:<file>" when real sending is off.
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("outgoing_emails_company_id_ticket_id_idx").on(
      table.companyId,
      table.ticketId,
    ),
    // Postgres refuses an email row whose ticket belongs to another company.
    foreignKey({
      name: "outgoing_emails_ticket_in_same_company_fk",
      columns: [table.companyId, table.ticketId],
      foreignColumns: [tickets.companyId, tickets.id],
    }),
  ],
);
