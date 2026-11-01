import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
// A relative path on purpose: drizzle-kit reads this file outside Next.js.
import type { ChannelConnectionStatus } from "../../lib/telegram";
import { users } from "./auth";
import { companies } from "./companies";

// Chat channels (step 48): a restaurant's Telegram account, connected to
// ansa's one bot as a Telegram Business chatbot. Telegram names the link
// between the account and the bot a "business connection"; its id comes
// with every customer message, and is how a webhook finds the company.

export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Only Telegram so far; Messenger (step 53) keeps its Page in social_connections.
    channel: text("channel").$type<"telegram">().notNull(),
    // Telegram's business connection id (a development stand-in's starts
    // with "stand-in:").
    externalId: text("external_id").notNull(),
    // The restaurant's Telegram account: its user id, and the bot's private
    // chat with it (where the bot writes to the owner).
    accountTelegramId: text("account_telegram_id").notNull(),
    accountChatId: text("account_chat_id").notNull(),
    // The account's name as Telegram gave it, one plain line.
    displayName: text("display_name").notNull(),
    status: text("status").$type<ChannelConnectionStatus>().notNull().default("connected"),
    isStandIn: boolean("is_stand_in").notNull().default(false),
    // The owner whose link connected it last.
    connectedByUserId: text("connected_by_user_id").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("channel_connections_company_id_id_unique").on(table.companyId, table.id),
    // One company at a time per Telegram account, and one Telegram account
    // per company, while it is tied (lib/telegram.ts, LIVE_CONNECTION_STATUSES).
    uniqueIndex("channel_connections_live_external_unique")
      .on(table.channel, table.externalId)
      .where(sql`${table.status} <> 'disconnected'`),
    uniqueIndex("channel_connections_live_company_unique")
      .on(table.companyId, table.channel)
      .where(sql`${table.status} <> 'disconnected'`),
    index("channel_connections_company_idx").on(table.companyId, table.connectedAt),
    foreignKey({
      name: "channel_connections_connector_in_same_company_fk",
      columns: [table.companyId, table.connectedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("channel_connections_channel_known", sql`${table.channel} IN ('telegram')`),
    check(
      "channel_connections_status_known",
      sql`${table.status} IN ('connected', 'cannot_reply', 'removed_in_telegram', 'disconnected')`,
    ),
    check("channel_connections_external_id_length", sql`char_length(${table.externalId}) BETWEEN 1 AND 200`),
    check("channel_connections_account_ids_digits", sql`${table.accountTelegramId} ~ '^-?[0-9]{1,20}$' AND ${table.accountChatId} ~ '^-?[0-9]{1,20}$'`),
    check("channel_connections_display_name_length", sql`char_length(${table.displayName}) BETWEEN 1 AND 200`),
    check("channel_connections_stand_in_id", sql`${table.isStandIn} = (${table.externalId} LIKE 'stand-in:%')`),
    check(
      "channel_connections_disconnected_at",
      sql`(${table.status} = 'disconnected') = (${table.disconnectedAt} IS NOT NULL)`,
    ),
  ],
);

// The one-time links that connect a Telegram account (Settings → Channels):
// only the code's SHA-256 hash is stored, it works for 10 minutes, and the
// Telegram user who pressed Start with it is recorded (claimed). The
// company comes from this row, never from anything Telegram sends.
export const telegramLinkCodes = pgTable(
  "telegram_link_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    createdByUserId: text("created_by_user_id").notNull(),
    codeHash: text("code_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Who pressed Start with it, and when.
    claimedByTelegramId: text("claimed_by_telegram_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    // When it connected an account: it never connects another.
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "telegram_link_codes_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("telegram_link_codes_hash_format", sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "telegram_link_codes_lifetime",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '10 minutes'`,
    ),
    check(
      "telegram_link_codes_claim_fields_together",
      sql`num_nonnulls(${table.claimedByTelegramId}, ${table.claimedAt}) IN (0, 2) AND (${table.usedAt} IS NULL OR ${table.claimedAt} IS NOT NULL)`,
    ),
    check("telegram_link_codes_claimer_digits", sql`${table.claimedByTelegramId} ~ '^-?[0-9]{1,20}$'`),
    // The claimed codes of one Telegram user, newest first (a connection arriving).
    index("telegram_link_codes_claimer_idx").on(table.claimedByTelegramId, table.claimedAt),
    // The daily job deletes the old ones of every company.
    index("telegram_link_codes_expires_at_idx").on(table.expiresAt),
  ],
);

// A Telegram account that added ansa's bot before pressing Start with a
// code from ansa: no company is known yet, so this row belongs to none. It
// waits an hour for its owner's code (the Start names the company), then
// the daily job deletes it. Holds Telegram's ids and the account's name
// only, never a message.
export const telegramPendingConnections = pgTable(
  "telegram_pending_connections",
  {
    externalId: text("external_id").primaryKey(),
    accountTelegramId: text("account_telegram_id").notNull(),
    accountChatId: text("account_chat_id").notNull(),
    displayName: text("display_name").notNull(),
    canReply: boolean("can_reply").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("telegram_pending_connections_account_idx").on(table.accountTelegramId, table.receivedAt),
    index("telegram_pending_connections_received_at_idx").on(table.receivedAt),
    check("telegram_pending_connections_ids_digits", sql`${table.accountTelegramId} ~ '^-?[0-9]{1,20}$' AND ${table.accountChatId} ~ '^-?[0-9]{1,20}$'`),
    check("telegram_pending_connections_external_id_length", sql`char_length(${table.externalId}) BETWEEN 1 AND 200`),
    check("telegram_pending_connections_display_name_length", sql`char_length(${table.displayName}) BETWEEN 1 AND 200`),
  ],
);
