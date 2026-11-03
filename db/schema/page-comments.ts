import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";
import { conversations } from "./conversations";
import { socialConnections } from "./social";
import { tickets } from "./tickets";

// A comment someone wrote under a business's Facebook Page post, and what
// ansa did with it (core/internal/comments). The company comes only from the
// Page id Meta signed (connected in exactly one company). Meta's ids are
// kept as Meta writes them: a comment arriving twice (an ad or a boosted
// post can send it again) is saved once. The comment, and ansa's public
// reply and private message, are encrypted with a context naming the
// company, the comment and the field (comments.TextContext). The post's own
// text is never stored here.
export const pageComments = pgTable(
  "page_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // The Page's connection (social_connections) and Meta's ids, as Meta writes them.
    connectionId: uuid("connection_id").notNull(),
    pageId: text("page_id").notNull(),
    postId: text("post_id").notNull(),
    commentId: text("comment_id").notNull(),
    // The comment it answers inside a thread (null or the post: a top-level comment).
    parentId: text("parent_id"),
    // Who wrote it: Meta's id for them, and their name as Meta gives it (one plain line).
    commenterId: text("commenter_id").notNull(),
    commenterName: text("commenter_name"),
    textEncrypted: text("text_encrypted").notNull(),
    commentedAt: timestamp("commented_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    // new (being answered), answered, waiting ("Ask me first"), skipped, failed.
    status: text("status").notNull().default("new"),
    skipReason: text("skip_reason"),
    // What the AI read it as.
    kind: text("kind"),
    // When ansa decided what to do with it, and when it started sending
    // (a run cut off after that never sends again by itself).
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    deliveryStartedAt: timestamp("delivery_started_at", { withTimezone: true }),
    // ansa's public reply under the comment.
    publicReplyEncrypted: text("public_reply_encrypted"),
    publicReplyStatus: text("public_reply_status"),
    publicReplyError: text("public_reply_error"),
    publicReplyCommentId: text("public_reply_comment_id"),
    // ansa's private message (Meta's private reply: one per comment, within
    // 7 days), the Messenger conversation it opened and Meta's message id.
    privateMessageEncrypted: text("private_message_encrypted"),
    privateMessageStatus: text("private_message_status"),
    privateMessageError: text("private_message_error"),
    privateMessageId: text("private_message_id"),
    conversationId: uuid("conversation_id"),
    // The request a person follows up (a complaint, or ansa unsure).
    ticketId: uuid("ticket_id"),
    // Who pressed Send or Discard on a waiting reply ("Ask me first").
    handledByUserId: text("handled_by_user_id"),
    handledAt: timestamp("handled_at", { withTimezone: true }),
  },
  (table) => [
    unique("page_comments_company_comment_unique").on(table.companyId, table.commentId),
    index("page_comments_company_received_idx").on(table.companyId, table.receivedAt),
    // Postgres refuses a Page, a conversation, a request or a person of another company.
    foreignKey({
      name: "page_comments_connection_in_same_company_fk",
      columns: [table.companyId, table.connectionId],
      foreignColumns: [socialConnections.companyId, socialConnections.id],
    }),
    foreignKey({
      name: "page_comments_conversation_in_same_company_fk",
      columns: [table.companyId, table.conversationId],
      foreignColumns: [conversations.companyId, conversations.id],
    }),
    foreignKey({
      name: "page_comments_ticket_in_same_company_fk",
      columns: [table.companyId, table.ticketId],
      foreignColumns: [tickets.companyId, tickets.id],
    }),
    foreignKey({
      name: "page_comments_handler_in_same_company_fk",
      columns: [table.companyId, table.handledByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("page_comments_status_known", sql`${table.status} IN ('new', 'answered', 'waiting', 'skipped', 'failed')`),
    check(
      "page_comments_skip_reason_known",
      sql`${table.skipReason} IN ('thanks', 'spam', 'own_comment', 'reply_in_thread', 'comments_off', 'package', 'limit', 'too_old', 'not_allowed', 'discarded')`,
    ),
    // A reason exactly on a skipped comment.
    check("page_comments_skip_reason_when_skipped", sql`(${table.status} = 'skipped') = (${table.skipReason} IS NOT NULL)`),
    check("page_comments_kind_known", sql`${table.kind} IN ('question', 'order', 'complaint', 'thanks', 'spam', 'unsure')`),
    check(
      "page_comments_public_reply_status_known",
      sql`${table.publicReplyStatus} IN ('sending', 'sent', 'failed', 'unclear', 'waiting', 'discarded')`,
    ),
    check(
      "page_comments_private_message_status_known",
      sql`${table.privateMessageStatus} IN ('sending', 'sent', 'failed', 'unclear', 'waiting', 'discarded')`,
    ),
    // A part's text and status come together.
    check("page_comments_public_reply_whole", sql`(${table.publicReplyEncrypted} IS NULL) = (${table.publicReplyStatus} IS NULL)`),
    check("page_comments_private_message_whole", sql`(${table.privateMessageEncrypted} IS NULL) = (${table.privateMessageStatus} IS NULL)`),
    // Why a part failed or may not have arrived: a code, never Meta's words.
    check("page_comments_public_reply_error_code", sql`${table.publicReplyError} IS NULL OR ${table.publicReplyError} ~ '^[a-z_]{1,40}$'`),
    check("page_comments_private_message_error_code", sql`${table.privateMessageError} IS NULL OR ${table.privateMessageError} ~ '^[a-z_]{1,40}$'`),
    check("page_comments_ids_length", sql`char_length(${table.commentId}) BETWEEN 1 AND 200 AND char_length(${table.postId}) BETWEEN 1 AND 200
      AND char_length(${table.pageId}) BETWEEN 1 AND 100 AND char_length(${table.commenterId}) BETWEEN 1 AND 200`),
    check("page_comments_commenter_name_length", sql`${table.commenterName} IS NULL OR char_length(${table.commenterName}) BETWEEN 1 AND 200`),
    // Send or Discard is recorded with who pressed it.
    check("page_comments_handled_together", sql`(${table.handledByUserId} IS NULL) = (${table.handledAt} IS NULL)`),
  ],
);
