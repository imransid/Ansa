import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
import type { HandoverReason } from "../../lib/assistant/reasons";
import type { ActivityAction, ConversationChannel, ConversationHandler } from "../../lib/conversations";
import { users } from "./auth";
import { companies } from "./companies";

// The Inbox (step 47). A contact is one customer on one channel: a Telegram
// or Messenger user, a phone number (its digits), an email address, or the
// development stand-in. Each contact has one conversation, which holds its
// messages (db/schema/messages.ts) and links its calls, received emails and
// tickets (their conversation_id). Same-company foreign keys everywhere.

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    channel: text("channel").$type<ConversationChannel>().notNull(),
    // Who they are on that channel: a Telegram user id, a Messenger id, the
    // digits of a phone number (lib/phone-number.ts), a lowercased email
    // address ("unverified:" first when the sender wasn't verified, step 25,
    // so a forged From never joins a real customer's conversation), or the
    // stand-in's name.
    externalId: text("external_id").notNull(),
    // As the channel or the customer gave it: one plain line, or null.
    displayName: text("display_name"),
    // Someone the owner marked important (step 51): the assistant never
    // answers them itself, it sends the holding reply and alerts the owner.
    important: boolean("important").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("contacts_company_id_id_unique").on(table.companyId, table.id),
    unique("contacts_company_channel_external_unique").on(table.companyId, table.channel, table.externalId),
    check("contacts_channel_known", sql`${table.channel} IN ('telegram', 'messenger', 'whatsapp', 'phone', 'email', 'stand_in')`),
    check("contacts_external_id_length", sql`char_length(${table.externalId}) BETWEEN 1 AND 400`),
    check("contacts_display_name_length", sql`char_length(${table.displayName}) BETWEEN 1 AND 200`),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").notNull(),
    // "assistant" until a person takes it over; "person" until they hand it back.
    handledBy: text("handled_by").$type<ConversationHandler>().notNull().default("assistant"),
    takenOverByUserId: text("taken_over_by_user_id"),
    takenOverAt: timestamp("taken_over_at", { withTimezone: true }),
    // The newest message, call or email: the Inbox's order.
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    // The customer's newest message: Messenger lets a business answer for 24
    // hours after it (step 53).
    lastCustomerMessageAt: timestamp("last_customer_message_at", { withTimezone: true }),
    // The newest customer message the assistant answered or decided about
    // (step 49): it never answers one twice. No foreign key: a message
    // deleted in Telegram is deleted here too.
    assistantHandledMessageId: uuid("assistant_handled_message_id"),
    // When the assistant looks again at a message you may still answer
    // yourself (step 51, "if I don't answer within N minutes"); null = nothing waits.
    assistantDueAt: timestamp("assistant_due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("conversations_company_id_id_unique").on(table.companyId, table.id),
    // One conversation per contact.
    unique("conversations_company_contact_unique").on(table.companyId, table.contactId),
    index("conversations_company_activity_idx").on(table.companyId, table.lastActivityAt),
    // The scheduled runs find the due ones of every company (db/assistant-due.ts).
    index("conversations_assistant_due_idx").on(table.assistantDueAt),
    foreignKey({
      name: "conversations_contact_in_same_company_fk",
      columns: [table.companyId, table.contactId],
      foreignColumns: [contacts.companyId, contacts.id],
    }),
    foreignKey({
      name: "conversations_taker_in_same_company_fk",
      columns: [table.companyId, table.takenOverByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("conversations_handled_by_known", sql`${table.handledBy} IN ('assistant', 'person')`),
    // A person handles it exactly while someone is recorded as having taken it over.
    check(
      "conversations_taken_over_fields_together",
      sql`num_nonnulls(${table.takenOverByUserId}, ${table.takenOverAt}) = CASE WHEN ${table.handledBy} = 'person' THEN 2 ELSE 0 END`,
    ),
  ],
);

// What happened in a conversation, for Home's "What ansa did" and the
// conversation's own history: the assistant's work (no actor) and a
// person's take over or hand back (the actor). Never a message's text.
export const assistantActivity = pgTable(
  "assistant_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    conversationId: uuid("conversation_id").notNull(),
    actorUserId: text("actor_user_id"),
    action: text("action").$type<ActivityAction>().notNull(),
    // Why the assistant handed over (step 49): only on "handed_over".
    reason: text("reason").$type<HandoverReason>(),
    // clock_timestamp(): rows written in one transaction keep their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("assistant_activity_company_created_idx").on(table.companyId, table.createdAt),
    foreignKey({
      name: "assistant_activity_conversation_in_same_company_fk",
      columns: [table.companyId, table.conversationId],
      foreignColumns: [conversations.companyId, conversations.id],
    }),
    foreignKey({
      name: "assistant_activity_actor_in_same_company_fk",
      columns: [table.companyId, table.actorUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check(
      "assistant_activity_action_known",
      sql`${table.action} IN ('call_solved', 'call_needs_person', 'email_made_request', 'taken_over', 'handed_back', 'replied', 'drafted', 'handed_over', 'draft_sent', 'draft_discarded', 'order_placed')`,
    ),
    check(
      "assistant_activity_reason_known",
      sql`${table.reason} IN ('unsure', 'complaint', 'refund', 'asked_for_person', 'order', 'needs_decision', 'important_person', 'price_not_on_menu', 'refund_promise', 'unknown_link', 'unusable_answer', 'model_failed', 'model_unavailable', 'reply_limit', 'send_failed', 'order_change', 'order_unclear', 'call_message')`,
    ),
    check("assistant_activity_reason_only_on_handover", sql`(${table.reason} IS NOT NULL) = (${table.action} = 'handed_over')`),
  ],
);

// When each person last read "While you were away" on Home (step 51): the
// card lists what the assistant did since then.
export const awaySummaryReads = pgTable(
  "away_summary_reads",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "away_summary_reads_pk", columns: [table.companyId, table.userId] }),
    foreignKey({
      name: "away_summary_reads_user_in_same_company_fk",
      columns: [table.companyId, table.userId],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);
