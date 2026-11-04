import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// The ansa phone app (core/internal/devices): an owner shows a QR code on
// ansa's website, the app scans it and is connected to that account (no
// login typed). While it runs, the app checks in; when none of the owners'
// phones has checked in for the minutes the owner chose
// (assistant_settings.follow_phone, phone_wait_minutes), ansa switches to
// away by itself, and back when a phone checks in again.

// The one-time codes inside the QR code: only the code's SHA-256 is stored,
// it works for 5 minutes, and the phone that uses it CLAIMS it in one
// UPDATE (used once). The company comes from this row, never from the app.
export const devicePairCodes = pgTable(
  "device_pair_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // The owner who showed the code: refused if they are no longer an owner.
    createdByUserId: text("created_by_user_id").notNull(),
    codeHash: text("code_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // When a phone used it: it never connects another.
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "device_pair_codes_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("device_pair_codes_hash_format", sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "device_pair_codes_lifetime",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '5 minutes'`,
    ),
    // core's hourly cleanup deletes the old ones of every company.
    index("device_pair_codes_expires_at_idx").on(table.expiresAt),
  ],
);

// A connected phone. Its token (32 random bytes) is given to the app once,
// when it pairs; only its SHA-256 is stored, and it names this row (and so
// the company) on every call the app makes. A removed phone keeps its row
// (removed_at), and its token is refused.
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // The owner whose code paired it: the phone acts as them ("I'm away"),
    // and only while they are an active owner.
    pairedByUserId: text("paired_by_user_id").notNull(),
    // The phone's name as the app sent it ("Rafa's iPhone"), one plain line.
    name: text("name").notNull(),
    platform: text("platform").$type<"ios" | "android">().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    pairedAt: timestamp("paired_at", { withTimezone: true }).notNull().defaultNow(),
    // The app's last check-in (null: none yet; paired_at counts until then).
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    unique("devices_company_id_id_unique").on(table.companyId, table.id),
    // A company's connected phones (the page's list, the watcher's look).
    index("devices_live_company_idx")
      .on(table.companyId)
      .where(sql`${table.removedAt} IS NULL`),
    foreignKey({
      name: "devices_pairer_in_same_company_fk",
      columns: [table.companyId, table.pairedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("devices_name_length", sql`char_length(${table.name}) BETWEEN 1 AND 60`),
    check("devices_platform_known", sql`${table.platform} IN ('ios', 'android')`),
    check("devices_token_hash_format", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

// When the phones switched ansa away or back by themselves: "Your phone was
// unreachable: ansa answers for you" (away), "Your phone is back" (back, with
// the phone that checked in). Never a message, never a person's own switch.
export const phonePresenceChanges = pgTable(
  "phone_presence_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    change: text("change").$type<"away" | "back">().notNull(),
    deviceId: uuid("device_id"),
    // clock_timestamp(): rows written in one transaction keep their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("phone_presence_changes_company_created_idx").on(table.companyId, table.createdAt),
    foreignKey({
      name: "phone_presence_changes_device_in_same_company_fk",
      columns: [table.companyId, table.deviceId],
      foreignColumns: [devices.companyId, devices.id],
    }),
    check("phone_presence_changes_change_known", sql`${table.change} IN ('away', 'back')`),
    // Back = a phone checked in (that phone); away = none was reachable.
    check("phone_presence_changes_device_on_back", sql`(${table.deviceId} IS NOT NULL) = (${table.change} = 'back')`),
  ],
);
