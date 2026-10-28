import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";

// The Co-Founder's performance reviews (step 42): what Claude found in one
// period of the company's post numbers, and what it recommends. One row per
// review an owner asked for, never changed; the newest is shown on the
// Analytics page and passed to the marketing planner (step 37) as past
// performance. input_summary is exactly what was sent (the posts by label,
// their numbers, the group totals); review is Claude's answer after the
// code kept only the findings whose every number matches it
// (lib/performance-review/review-answer.ts). The company's own marketing
// numbers and topics: plain JSON, like the plans.
export const performanceReviews = pgTable(
  "performance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // The posts published from period_start to period_end were reviewed.
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    inputSummary: jsonb("input_summary").notNull(),
    review: jsonb("review").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Lets a marketing plan point at a review of the same company.
    unique("performance_reviews_company_id_id_unique").on(table.companyId, table.id),
    // Postgres refuses an owner from another company as the review's maker.
    foreignKey({
      name: "performance_reviews_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("performance_reviews_period_order", sql`${table.periodEnd} > ${table.periodStart}`),
    check("performance_reviews_input_is_object", sql`jsonb_typeof(${table.inputSummary}) = 'object'`),
    check("performance_reviews_review_is_object", sql`jsonb_typeof(${table.review}) = 'object'`),
    // Far above what lib/performance-review/limits.ts lets either hold: a
    // safety net under the code.
    check("performance_reviews_input_size", sql`char_length(${table.inputSummary}::text) <= 200000`),
    check("performance_reviews_review_size", sql`char_length(${table.review}::text) <= 100000`),
    // The Analytics page shows the newest; the planner reads it too.
    index("performance_reviews_company_id_created_at_idx").on(table.companyId, table.createdAt),
  ],
);
