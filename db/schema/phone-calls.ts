import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { conversations } from "./conversations";

// Calls the assistant answers live (step 55): someone who couldn't reach the
// person or the business talks with ansa, turn by turn, in the caller's
// conversation (contacts.channel "phone": their words and ansa's are its
// messages). One row per call. While ended_at is empty the conversation may
// take the assistant's spoken words (core/internal/chat); nothing else can
// send to a phone conversation. The line says where the call came from:
// "practice" is the development practice phone; each production provider
// (chosen at launch: Vapi, Twilio, Telnyx or LiveKit) gets its own name.
export const phoneCalls = pgTable(
  "phone_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    conversationId: uuid("conversation_id").notNull(),
    line: text("line").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // How often the caller spoke while ansa only took messages (the
    // assistant paused, a person handling the conversation, a caller marked
    // important, or past the call's limits): when the call ends, a request is
    // opened for them if none is open.
    messagesTaken: integer("messages_taken").notNull().default(0),
  },
  (table) => [
    foreignKey({
      name: "phone_calls_conversation_in_same_company_fk",
      columns: [table.companyId, table.conversationId],
      foreignColumns: [conversations.companyId, conversations.id],
    }),
    check("phone_calls_line_known", sql`${table.line} IN ('practice')`),
    check("phone_calls_ends_after_start", sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`),
    check("phone_calls_messages_taken_not_negative", sql`${table.messagesTaken} >= 0`),
    // One live call per conversation at a time.
    uniqueIndex("phone_calls_one_live_per_conversation")
      .on(table.companyId, table.conversationId)
      .where(sql`${table.endedAt} IS NULL`),
    index("phone_calls_company_started_idx").on(table.companyId, table.startedAt),
  ],
);
