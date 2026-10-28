import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// Who wrote one message of the Co-Founder's interview.
export const interviewMessageAuthors = ["assistant", "owner"] as const;
export type InterviewMessageAuthor = (typeof interviewMessageAuthors)[number];

// The Co-Founder's interview (step 36): its questions and the owners'
// answers, oldest first, so the interview can be picked up where it was left.
// "Start over" deletes a company's messages (never its facts).
export const onboardingMessages = pgTable(
  "onboarding_messages",
  {
    // No default on purpose: the service makes the id before encrypting the
    // text, because the encryption context names it.
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    author: text("author").$type<InterviewMessageAuthor>().notNull(),
    // The owner who answered; empty for the Co-Founder's own messages.
    authorUserId: text("author_user_id"),
    // The text, encrypted (lib/encryption.ts, onboardingMessageContext): an
    // owner may type anything into an answer, a card number or a password.
    bodyEncrypted: text("body_encrypted").notNull(),
    // The Co-Founder's message says the interview covered every key topic
    // (lib/cofounder/interview-reply.ts).
    endsInterview: boolean("ends_interview").notNull().default(false),
    // clock_timestamp(), not now(): a question and the answer saved in one
    // transaction must keep their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // Postgres refuses an answer by someone from another company.
    foreignKey({
      name: "onboarding_messages_author_in_same_company_fk",
      columns: [table.companyId, table.authorUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("onboarding_messages_author_known", sql`${table.author} IN ('assistant', 'owner')`),
    // Every answer names its owner, and only answers do.
    check("onboarding_messages_owner_named", sql`(${table.author} = 'owner') = (${table.authorUserId} IS NOT NULL)`),
    check("onboarding_messages_only_assistant_ends", sql`${table.author} = 'assistant' OR NOT ${table.endsInterview}`),
    // The interview page and each turn read one company's newest messages.
    index("onboarding_messages_company_id_created_at_idx").on(table.companyId, table.createdAt),
  ],
);
