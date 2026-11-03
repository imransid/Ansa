import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// WhatsApp Business (step 56): a company's WhatsApp number, connected
// through Meta's official Cloud API with Embedded Signup (Meta's own
// sign-up window). Meta names the number by its phone number id, which
// comes with every customer message: that is how a webhook finds the
// company, only when exactly one company has the number connected. The
// business may keep using the WhatsApp Business app on its phone
// ("coexistence"): what it writes there reaches ansa too. The access token
// Meta gives for the business is encrypted (core/internal/whatsapp,
// TokenContext: company and number). A development stand-in's ids start
// with "stand-in:" and it has no token.
export const whatsappNumbers = pgTable(
  "whatsapp_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // The business's WhatsApp Business Account and its number, by Meta's ids.
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    // The number and the business's name as Meta gives them, one plain line each.
    displayPhoneNumber: text("display_phone_number").notNull(),
    verifiedName: text("verified_name"),
    // The number is also in use in the WhatsApp Business app (coexistence).
    sharedWithApp: boolean("shared_with_app").notNull().default(false),
    tokenEncrypted: text("token_encrypted"),
    // connected; removed_in_whatsapp (the business ended the link on Meta's
    // side: nothing arrives); disconnected (an owner, in ansa: final).
    status: text("status").$type<"connected" | "removed_in_whatsapp" | "disconnected">().notNull().default("connected"),
    // Why the last send couldn't use the number, as a code (null = none).
    lastError: text("last_error"),
    isStandIn: boolean("is_stand_in").notNull().default(false),
    connectedByUserId: text("connected_by_user_id").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("whatsapp_numbers_company_id_id_unique").on(table.companyId, table.id),
    // A number is tied to one company at a time, and a company has one
    // number, while it isn't disconnected.
    uniqueIndex("whatsapp_numbers_live_number_unique")
      .on(table.phoneNumberId)
      .where(sql`${table.status} <> 'disconnected'`),
    uniqueIndex("whatsapp_numbers_live_company_unique")
      .on(table.companyId)
      .where(sql`${table.status} <> 'disconnected'`),
    index("whatsapp_numbers_waba_idx").on(table.wabaId),
    foreignKey({
      name: "whatsapp_numbers_connector_in_same_company_fk",
      columns: [table.companyId, table.connectedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("whatsapp_numbers_status_known", sql`${table.status} IN ('connected', 'removed_in_whatsapp', 'disconnected')`),
    check("whatsapp_numbers_ids_shape", sql`(${table.isStandIn} AND ${table.wabaId} LIKE 'stand-in:%' AND ${table.phoneNumberId} LIKE 'stand-in:%')
      OR (NOT ${table.isStandIn} AND ${table.wabaId} ~ '^[0-9]{1,40}$' AND ${table.phoneNumberId} ~ '^[0-9]{1,40}$')`),
    check("whatsapp_numbers_display_phone_length", sql`char_length(${table.displayPhoneNumber}) BETWEEN 1 AND 40`),
    check("whatsapp_numbers_verified_name_length", sql`${table.verifiedName} IS NULL OR char_length(${table.verifiedName}) BETWEEN 1 AND 200`),
    // A real number in use has its token; a stand-in or a disconnected one has none.
    check(
      "whatsapp_numbers_token",
      sql`(${table.tokenEncrypted} IS NOT NULL) = (NOT ${table.isStandIn} AND ${table.status} <> 'disconnected')`,
    ),
    check("whatsapp_numbers_disconnected_at", sql`(${table.status} = 'disconnected') = (${table.disconnectedAt} IS NOT NULL)`),
    check("whatsapp_numbers_last_error_code", sql`${table.lastError} IS NULL OR ${table.lastError} ~ '^[a-z_]{1,40}$'`),
  ],
);
