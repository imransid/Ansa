import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { tickets } from "./tickets";

// An address a company's customers write to, like support@acme.com, as an
// owner typed it on the Setup page. Shown there, and used to spot email the
// company's own mailbox sent back to itself. It NEVER decides which company an
// email belongs to: anyone can type any address. Only the company's forwarding
// address does (companies.inbound_token, step 24).
export const inboundAddresses = pgTable(
  "inbound_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Stored lowercase.
    address: text("address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("inbound_addresses_company_id_id_unique").on(table.companyId, table.id),
    // Unique within one company only: another company listing the same address
    // changes nothing for this one, and nobody learns which addresses are taken.
    unique("inbound_addresses_company_id_address_unique").on(table.companyId, table.address),
  ],
);

// received -> processing -> ticketed | ignored. See services/inbound-email-processing.ts.
// A run that stopped half way leaves "received" or "processing" behind; the
// scheduled job and the Emails page run those again (step 27). "ignored" goes
// back to "processing" only through the Emails page ("Process again", "Make a
// ticket anyway").
export const inboundEmailStatuses = ["received", "processing", "ticketed", "ignored"] as const;
export const inboundEmailStatusEnum = pgEnum("inbound_email_status", inboundEmailStatuses);
export type InboundEmailStatus = (typeof inboundEmailStatuses)[number];

// One email that reached a company's forwarding address (steps 15 and 24).
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
    // Filled in once the content is fetched from Resend, also for an email
    // that is ignored (the Emails page lists who sent it). Subject and body are
    // encrypted like call transcripts (lib/encryption.ts); the sender's
    // address may become the ticket's customer email, so it is stored plainly.
    // When From holds no valid address, this is what it held instead (capped).
    fromAddress: text("from_address"),
    // True only when Resend reported that the email passed DKIM or DMARC
    // (step 25). Anyone can write any address in From, so only then does the
    // sender become the ticket's customer email on its own; otherwise the
    // ticket shows the sender as "not verified" for an expert to confirm.
    // False for every email received before step 25: none was checked.
    senderVerified: boolean("sender_verified").notNull().default(false),
    // The email's one Reply-To address, when it differs from From: website
    // contact forms and other relays send from their own address and put the
    // customer here (step 27). Anyone can write it, so it is only ever shown
    // to an expert as a suggestion, never used on its own.
    replyToAddress: text("reply_to_address"),
    // Both capped (services/inbound-email-content.ts). The body is the
    // plain-text part, or, for an email without one (body_from_html), text
    // made from its HTML part, never the HTML itself; null when that HTML held
    // no text (the ticket says so).
    subjectEncrypted: text("subject_encrypted"),
    bodyEncrypted: text("body_encrypted"),
    bodyFromHtml: boolean("body_from_html").notNull().default(false),
    // Attachments are not stored: only how many there were, and their file
    // names (encrypted like the body, as a JSON list), so the ticket can say so.
    attachmentCount: integer("attachment_count").notNull().default(0),
    attachmentNamesEncrypted: text("attachment_names_encrypted"),
    // Images the HTML showed inside the email (logos, signatures, pasted
    // pictures: "cid:" references), counted apart from the attachments above
    // so the ticket doesn't ask customers for files they never attached. Not
    // stored either. 0 for emails received before it was counted.
    inlineImageCount: integer("inline_image_count").notNull().default(0),
    // The ticket made from it (same company, see the foreign key below).
    ticketId: uuid("ticket_id"),
    // When the latest processing run started (each claim sets it). A run still
    // "processing" 15 minutes later was cut off (a crash, a deploy, a time
    // limit), so another run may claim the email (db/inbound-email-processing.ts).
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
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
    // Without a start time a stuck run could never be told apart from a live one.
    check("inbound_emails_processing_has_start_time", sql`${table.status} <> 'processing' OR ${table.processingStartedAt} IS NOT NULL`),
    // Setup reads each company's newest email on every load (getLastInboundEmail),
    // and the Emails page lists them newest first. Without it Postgres reads and
    // sorts every company's emails each time.
    index("inbound_emails_company_id_received_at_idx").on(table.companyId, table.receivedAt),
    // Every ticket page looks up the email its ticket came from
    // (getInboundEmailForTicket), phone tickets too, and ticket search looks
    // through the senders. Without it that reads every company's emails.
    index("inbound_emails_company_id_ticket_id_idx").on(table.companyId, table.ticketId),
    // The scheduled job looks for unfinished emails of every company
    // (db/stuck-work.ts); there are only ever a few of those.
    index("inbound_emails_unfinished_idx")
      .on(table.receivedAt)
      .where(sql`${table.status} in ('received', 'processing')`),
  ],
);
