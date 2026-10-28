import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./companies";
import { performanceReviews } from "./performance-reviews";

// The Co-Founder's marketing plans (step 37), one row per version: the
// newest is the company's current plan, older ones are kept and listed.
// Each row also says what the plan was made from, so it stays clear later
// what it was based on. Plain JSON on purpose, like the business facts it
// is made from: the company's own marketing, not customer data (the only
// support-derived input, ticket counts per category, is not stored here).
export const marketingPlans = pgTable(
  "marketing_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // 1, 2, 3, ... per company, taken under the company row lock
    // (db/marketing-plans.ts), never chosen by the caller.
    version: integer("version").notNull(),
    // What the owner asked this plan to focus on; empty: nothing.
    goalNote: text("goal_note"),
    // The plan as lib/marketing-plan/plan-schema.ts read it, the fact rule applied.
    plan: jsonb("plan").notNull(),
    // The confirmed facts the request held, [{ topic, value }], as they were then.
    factsUsed: jsonb("facts_used").notNull(),
    // The approved marketing articles the request held, best first. No
    // foreign key (Postgres has none for array elements): an article
    // deleted since shows as deleted.
    knowledgeUsed: uuid("knowledge_used").array().notNull(),
    // The owner's support-trends setting was on, so the request held the
    // ticket counts per category of the last 30 days.
    usedSupportTrends: boolean("used_support_trends").notNull(),
    // The performance review (step 42) whose findings the request held as
    // past performance; empty: there was none.
    performanceReviewId: uuid("performance_review_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per version of a company; also what the newest-first reads use.
    unique("marketing_plans_company_id_version_unique").on(table.companyId, table.version),
    // Postgres refuses an owner from another company as the plan's maker.
    foreignKey({
      name: "marketing_plans_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // ... and a review of another company as its past performance.
    foreignKey({
      name: "marketing_plans_review_in_same_company_fk",
      columns: [table.companyId, table.performanceReviewId],
      foreignColumns: [performanceReviews.companyId, performanceReviews.id],
    }),
    check("marketing_plans_version_positive", sql`${table.version} >= 1`),
    // The limits of lib/marketing-plan/limits.ts, as a safety net under Zod.
    check("marketing_plans_goal_note_length", sql`char_length(${table.goalNote}) BETWEEN 1 AND 1000`),
    check("marketing_plans_plan_is_object", sql`jsonb_typeof(${table.plan}) = 'object'`),
    check("marketing_plans_plan_size", sql`char_length(${table.plan}::text) <= 200000`),
    check("marketing_plans_facts_used_is_array", sql`jsonb_typeof(${table.factsUsed}) = 'array'`),
    // A search gives at most 10 hits, so a plan reads at most 10 articles.
    check("marketing_plans_knowledge_used_count", sql`cardinality(${table.knowledgeUsed}) <= 10`),
  ],
);
