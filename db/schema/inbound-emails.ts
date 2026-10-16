import { sql } from "drizzle-orm";
import { check, foreignKey, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { tickets } from "./tickets";

// An email address customers write to, like support@acme.com forwarded to us.
// This mapping is the ONLY thing that decides which company an email belongs
// to: nothing in the email itself is trusted for that (same idea as phone_lines).
export const inboundAddresses = pgTable(
  "inbound_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Stored lowercase. One address belongs to exactly one company.
    address: text("address").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("inbound_addresses_company_id_id_unique").on(table.companyId, table.id)],
);

// received -> processing -> ticketed | ignored. See services/inbound-email-processing.ts.
export const inboundEmailStatuses = ["received", "processing", "ticketed", "ignored"] as const;
export const inboundEmailStatusEnum = pgEnum("inbound_email_status", inboundEmailStatuses);

// One email a customer sent to a company's inbound address (step 15).
export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Resend's id. Unique, so a webhook delivered twice is handled once.
    resendEmailId: text("resend_email_id").notNull().unique(),
    status: inboundEmailStatusEnum("status").notNull().default("received"),
    // Why it was ignored (a fixed code, e.g. "auto_reply"), if it was.
    ignoredReason: text("ignored_reason"),
    // Filled in once the content is fetched from Resend. Subject and body are
    // encrypted like call transcripts (lib/encryption.ts); the sender's
    // address becomes the ticket's customer email, so it is stored plainly.
    fromAddress: text("from_address"),
    subjectEncrypted: text("subject_encrypted"),
    bodyEncrypted: text("body_encrypted"),
    // The ticket made from it (same company, see the foreign key below).
    ticketId: uuid("ticket_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "inbound_emails_ticket_in_same_company_fk",
      columns: [table.companyId, table.ticketId],
      foreignColumns: [tickets.companyId, tickets.id],
    }),
    check("inbound_emails_ticket_matches_status", sql`(${table.status} = 'ticketed') = (${table.ticketId} IS NOT NULL)`),
  ],
);
