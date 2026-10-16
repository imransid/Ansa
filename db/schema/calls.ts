import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

// A phone number a company's customers call, as known to Vapi.
// This mapping is the ONLY thing that decides which company a call belongs
// to: nothing in the webhook payload is trusted for that.
export const phoneLines = pgTable(
  "phone_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Vapi's id for the number (message.call.phoneNumberId). One number belongs
    // to exactly one company.
    vapiPhoneNumberId: text("vapi_phone_number_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Lets calls use a (company_id, phone_line_id) foreign key.
  (table) => [unique("phone_lines_company_id_id_unique").on(table.companyId, table.id)],
);

// One finished phone call, saved from Vapi's end-of-call-report.
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    phoneLineId: uuid("phone_line_id").notNull(),
    // Vapi's call id. Unique, so Vapi sending the same report twice saves it once.
    vapiCallId: text("vapi_call_id").notNull().unique(),
    // The customer's number, if not withheld. Shown in the app, never logged.
    callerNumber: text("caller_number"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    // Encrypted with lib/encryption.ts (AES-256-GCM). Never stored or logged in plain text.
    transcriptEncrypted: text("transcript_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("calls_company_id_created_at_idx").on(table.companyId, table.createdAt),
    // Postgres refuses a call whose phone line belongs to another company.
    foreignKey({
      name: "calls_phone_line_in_same_company_fk",
      columns: [table.companyId, table.phoneLineId],
      foreignColumns: [phoneLines.companyId, phoneLines.id],
    }),
  ],
);
