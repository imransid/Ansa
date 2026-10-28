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

// pending (never tried) -> sending (a delivery claimed it, services/customer-emails.ts)
// -> sent | failed. Retry starts again from failed (or from a send that was
// interrupted: still "sending" long after it started).
export const emailStatuses = ["pending", "sending", "sent", "failed"] as const;
export const emailStatusEnum = pgEnum("email_status", emailStatuses);
export type EmailStatus = (typeof emailStatuses)[number];

// Reported by Resend after an email was sent (step 17 delivery webhook):
// bounced (the receiving server refused it), complained (the customer marked
// it as spam), suppressed (Resend didn't send it: the address bounced or
// complained before, for any company, step 27), failed (Resend couldn't send
// it). Only "complained" was delivered.
export const deliveryProblems = ["bounced", "complained", "suppressed", "failed"] as const;
export const deliveryProblemEnum = pgEnum("email_delivery_problem", deliveryProblems);
export type DeliveryProblem = (typeof deliveryProblems)[number];

// Every email we send to a customer. A row is written in the same database
// transaction as the change that causes it (for example marking a ticket
// solved), so an email can never be silently forgotten. Delivery happens right
// after; a failed delivery stays visible here and can be retried.
export const outgoingEmails = pgTable(
  "outgoing_emails",
  {
    // Also used as the delivery idempotency key, so a retry within Resend's
    // 24 hours never sends twice (see first_attempt_at for later ones).
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id").notNull(),
    kind: emailKindEnum("kind").notNull(),
    // Copied from the ticket when the email is queued.
    toEmail: text("to_email").notNull(),
    status: emailStatusEnum("status").notNull().default("pending"),
    // Deliveries started (each claim counts one).
    attemptCount: integer("attempt_count").notNull().default(0),
    // When the first delivery started. Resend forgets the idempotency key 24
    // hours after it was first used, so a retry after that could send the
    // customer a second email: Retry asks first once this is 23 hours old.
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    // When the latest delivery started. A row still "sending" 10 minutes later
    // was interrupted (the server stopped mid-send) and may be retried.
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    // The error code of the last failed attempt (Resend's code like
    // "validation_error", or a file error code like "EROFS"; never a provider's
    // free-text message), or "daily_limit" when the company's daily limit held
    // the last attempt back.
    lastError: text("last_error"),
    // Resend's email id, or "dev-outbox:<file>" when real sending is off.
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Set from Resend's delivery webhook (see deliveryProblems above).
    deliveryProblem: deliveryProblemEnum("delivery_problem"),
    deliveryProblemAt: timestamp("delivery_problem_at", { withTimezone: true }),
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
    // Delivery webhooks find the email by Resend's id.
    index("outgoing_emails_provider_message_id_idx").on(table.providerMessageId),
    // The dashboard counts, and the Emails page lists, the emails that never
    // reached the customer (db/undelivered-emails.ts) on every view: failed,
    // not sent yet, or sent with a delivery problem. This finds those few
    // without reading every email the company ever sent.
    index("outgoing_emails_company_id_status_delivery_problem_idx").on(table.companyId, table.status, table.deliveryProblem),
    // Postgres refuses an email row whose ticket belongs to another company.
    foreignKey({
      name: "outgoing_emails_ticket_in_same_company_fk",
      columns: [table.companyId, table.ticketId],
      foreignColumns: [tickets.companyId, tickets.id],
    }),
  ],
);
