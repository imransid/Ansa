import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
// A relative path on purpose: drizzle-kit reads this file outside Next.js.
import type { MessageAuthor, SendError, SendStatus } from "../../lib/conversations";
import { users } from "./auth";
import { calls } from "./calls";
import { companies } from "./companies";
import { conversations } from "./conversations";
import { inboundEmails } from "./inbound-emails";

// One entry of a conversation (step 47): a chat message (its text encrypted
// with conversationMessageContext), or a link to a call or a received email
// of the same company, which keep their own content (never copied here).
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    conversationId: uuid("conversation_id").notNull(),
    direction: text("direction").$type<"in" | "out">().notNull(),
    author: text("author").$type<MessageAuthor>().notNull(),
    // The person who wrote it, for a person's reply.
    authorUserId: text("author_user_id"),
    bodyEncrypted: text("body_encrypted"),
    callId: uuid("call_id").unique(),
    inboundEmailId: uuid("inbound_email_id").unique(),
    // An outgoing message's delivery (lib/conversations.ts, SEND_STATUSES).
    sendStatus: text("send_status").$type<SendStatus>(),
    // Why it failed or may not have arrived (lib/conversations.ts, SEND_ERRORS).
    sendError: text("send_error").$type<SendError>(),
    // The channel's own id for the message: the same message arriving twice
    // is saved once.
    channelMessageId: text("channel_message_id"),
    // clock_timestamp(): messages saved in one transaction keep their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    unique("messages_conversation_channel_message_unique").on(table.conversationId, table.channelMessageId),
    foreignKey({
      name: "messages_conversation_in_same_company_fk",
      columns: [table.companyId, table.conversationId],
      foreignColumns: [conversations.companyId, conversations.id],
    }),
    foreignKey({
      name: "messages_author_in_same_company_fk",
      columns: [table.companyId, table.authorUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "messages_call_in_same_company_fk",
      columns: [table.companyId, table.callId],
      foreignColumns: [calls.companyId, calls.id],
    }),
    foreignKey({
      name: "messages_inbound_email_in_same_company_fk",
      columns: [table.companyId, table.inboundEmailId],
      foreignColumns: [inboundEmails.companyId, inboundEmails.id],
    }),
    check("messages_direction_known", sql`${table.direction} IN ('in', 'out')`),
    check("messages_author_known", sql`${table.author} IN ('customer', 'assistant', 'person', 'business_account')`),
    check("messages_send_status_known", sql`${table.sendStatus} IN ('draft', 'sending', 'sent', 'failed', 'unclear', 'discarded')`),
    check(
      "messages_send_error_known",
      sql`${table.sendError} IN ('not_connected', 'cannot_reply', 'reply_window_closed', 'refused', 'bot_rejected', 'rate_limited', 'no_answer')`,
    ),
    // A reason only on a message that failed or may not have arrived.
    check("messages_send_error_only_when_not_sent", sql`${table.sendError} IS NULL OR ${table.sendStatus} IN ('failed', 'unclear')`),
    // Exactly one of: a text, a call, an email.
    check("messages_one_kind", sql`num_nonnulls(${table.bodyEncrypted}, ${table.callId}, ${table.inboundEmailId}) = 1`),
    // The customer writes in; the assistant and people write out, with a delivery status.
    check(
      "messages_author_matches_direction",
      sql`(${table.author} = 'customer') = (${table.direction} = 'in') AND (${table.direction} = 'out') = (${table.sendStatus} IS NOT NULL)`,
    ),
    check("messages_person_named", sql`(${table.author} = 'person') = (${table.authorUserId} IS NOT NULL)`),
  ],
);
