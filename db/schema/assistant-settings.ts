import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
import type { OpeningHours } from "../../lib/opening-hours";
import type { AnswerWhen } from "../../lib/assistant/availability";
import type { AiEngine } from "../../lib/assistant/engine";
import type { AutopostFrequency, AutopostMode } from "../../lib/autopost/schedule";
import { DEFAULT_HOLDING_REPLY, type AssistantStatus, type ReplyMode } from "../../lib/restaurant-setup";
import { users } from "./auth";
import { companies } from "./companies";

// How one restaurant's assistant works and what it knows about running the
// place (step 45): one row per company, written by the setup at /welcome and
// Settings (owners only, db/assistant-settings.ts). The business's name, what
// it serves and where it is are business facts (db/schema/business-facts.ts),
// so posts can use them too. Plain text on purpose: the restaurant's own
// information, written for its customers. Nothing here is sent to anyone
// before step 49.
export const assistantSettings = pgTable(
  "assistant_settings",
  {
    companyId: uuid("company_id")
      .primaryKey()
      .references(() => companies.id, { onDelete: "restrict" }),
    // "paused": the assistant answers nobody (step 49).
    status: text("status").$type<AssistantStatus>().notNull().default("on"),
    // Automatic by default (2026-10-31 decision); "ask_first" waits for the owner.
    replyMode: text("reply_mode").$type<ReplyMode>().notNull().default("automatic"),
    // What a customer gets when the assistant can't answer, or for a
    // complaint or a refund, while the owner is alerted.
    holdingReply: text("holding_reply").notNull().default(DEFAULT_HOLDING_REPLY),
    // The owner's own words for the assistant ("Mention today's special").
    instructions: text("instructions").notNull().default(""),
    takesOrders: boolean("takes_orders").notNull().default(true),
    // An IANA zone ("Europe/Rome"); the hours are in it.
    timeZone: text("time_zone"),
    // lib/opening-hours.ts's shape, written only by its Zod schema.
    openingHours: jsonb("opening_hours").$type<OpeningHours>(),
    delivery: boolean("delivery").notNull().default(false),
    // Where, how much, the minimum: as the owner writes it.
    deliveryNote: text("delivery_note").notNull().default(""),
    // Added to every delivery order's total by ansa (step 52), in the
    // currency's smallest unit; 0 = free delivery.
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    pickup: boolean("pickup").notNull().default(true),
    paymentNote: text("payment_note").notNull().default(""),
    // ISO 4217 ("EUR"): every price on the menu (step 46) is in it.
    currency: text("currency"),
    // The number customers may call; null = none given.
    publicPhone: text("public_phone"),
    // Alerts ("Needs you") by email; Telegram joins in step 48.
    alertByEmail: boolean("alert_by_email").notNull().default(true),
    // Which AI answers (step 49, lib/assistant/engine.ts), and the
    // restaurant's own Claude API key: encrypted (anthropicKeyContext),
    // never shown back but its last four characters.
    aiEngine: text("ai_engine").$type<AiEngine>().notNull().default("api_key"),
    anthropicKeyEncrypted: text("anthropic_key_encrypted"),
    anthropicKeyHint: text("anthropic_key_hint"),
    // When ansa answers (step 51, lib/assistant/availability.ts): always, or
    // only while you are away: "I'm away" (away_since), your away hours (in
    // time_zone, the opening hours' shape), or no answer from you within
    // reply_grace_minutes.
    answerWhen: text("answer_when").$type<AnswerWhen>().notNull().default("always"),
    awaySince: timestamp("away_since", { withTimezone: true }),
    awayHours: jsonb("away_hours").$type<OpeningHours>(),
    replyGraceMinutes: integer("reply_grace_minutes"),
    // "Post for me" (step 54, lib/autopost/): ansa posts on the business's
    // Facebook Page by itself, how often and at what local time (in
    // time_zone), automatically or waiting for an owner's approval. Who
    // switched it on, and when: posts stop if they are no longer an owner.
    autopostEnabled: boolean("autopost_enabled").notNull().default(false),
    autopostFrequency: text("autopost_frequency").$type<AutopostFrequency>().notNull().default("three_a_week"),
    autopostTime: text("autopost_time").notNull().default("11:00"),
    autopostMode: text("autopost_mode").$type<AutopostMode>().notNull().default("automatic"),
    autopostEnabledByUserId: text("autopost_enabled_by_user_id"),
    autopostEnabledAt: timestamp("autopost_enabled_at", { withTimezone: true }),
    // Answering comments on the business's Facebook Page posts
    // (core/internal/comments): off until an owner switches it on.
    commentsOn: boolean("comments_on").notNull().default(false),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Postgres refuses someone from another company as the last changer.
    foreignKey({
      name: "assistant_settings_updater_in_same_company_fk",
      columns: [table.companyId, table.updatedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "assistant_settings_autopost_enabler_in_same_company_fk",
      columns: [table.companyId, table.autopostEnabledByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("assistant_settings_autopost_frequency_known", sql`${table.autopostFrequency} IN ('daily', 'three_a_week', 'weekly')`),
    check("assistant_settings_autopost_mode_known", sql`${table.autopostMode} IN ('automatic', 'ask_first')`),
    check("assistant_settings_autopost_time_format", sql`${table.autopostTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    // On exactly when an owner switched it on, with a time zone to post in.
    check(
      "assistant_settings_autopost_enabler",
      sql`${table.autopostEnabled} = (${table.autopostEnabledByUserId} IS NOT NULL AND ${table.autopostEnabledAt} IS NOT NULL) AND (NOT ${table.autopostEnabled} OR ${table.timeZone} IS NOT NULL)`,
    ),
    // The lists and limits of lib/restaurant-setup.ts, as a safety net under Zod.
    check("assistant_settings_status_known", sql`${table.status} IN ('on', 'paused')`),
    check("assistant_settings_reply_mode_known", sql`${table.replyMode} IN ('automatic', 'ask_first')`),
    check("assistant_settings_ai_engine_known", sql`${table.aiEngine} IN ('api_key', 'claude_code')`),
    check(
      "assistant_settings_anthropic_key_with_hint",
      sql`num_nonnulls(${table.anthropicKeyEncrypted}, ${table.anthropicKeyHint}) IN (0, 2) AND char_length(${table.anthropicKeyHint}) = 4`,
    ),
    check("assistant_settings_holding_reply_length", sql`char_length(${table.holdingReply}) BETWEEN 1 AND 500`),
    check("assistant_settings_instructions_length", sql`char_length(${table.instructions}) <= 2000`),
    check("assistant_settings_delivery_note_length", sql`char_length(${table.deliveryNote}) <= 500`),
    check("assistant_settings_delivery_fee_range", sql`${table.deliveryFeeCents} BETWEEN 0 AND 100000000`),
    check("assistant_settings_payment_note_length", sql`char_length(${table.paymentNote}) <= 500`),
    check("assistant_settings_public_phone_length", sql`char_length(${table.publicPhone}) BETWEEN 1 AND 40`),
    check("assistant_settings_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    // Hours mean nothing without the zone they are in (a person has away
    // hours and no opening hours, step 51).
    check(
      "assistant_settings_hours_with_time_zone",
      sql`(${table.openingHours} IS NULL OR ${table.timeZone} IS NOT NULL) AND (${table.awayHours} IS NULL OR ${table.timeZone} IS NOT NULL)`,
    ),
    check("assistant_settings_answer_when_known", sql`${table.answerWhen} IN ('always', 'when_away')`),
    check("assistant_settings_away_hours_object", sql`jsonb_typeof(${table.awayHours}) = 'object'`),
    check("assistant_settings_reply_grace_known", sql`${table.replyGraceMinutes} IN (5, 10, 15, 30, 60)`),
    check("assistant_settings_time_zone_length", sql`char_length(${table.timeZone}) BETWEEN 1 AND 64`),
    check("assistant_settings_opening_hours_object", sql`jsonb_typeof(${table.openingHours}) = 'object'`),
  ],
);
