import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
import type { CofounderActivityAction } from "../../lib/publishing/activity-actions";
import { users } from "./auth";
import { companies } from "./companies";
import { contentDrafts } from "./content-drafts";
import { marketingPlans } from "./marketing-plans";
import { autopublishRules, publishJobs } from "./publishing";
import { socialConnections } from "./social";

// The Co-Founder's activity log (step 41): who did what to the company's
// social accounts, drafts, publish jobs, auto-publish rules and marketing
// plans, and when. Each row is written by the /db function that makes the
// change, in the SAME transaction (like ticket_activity), and never changed
// or deleted. No token and no post text: what it was about is pointed at.
export const cofounderActivity = pgTable(
  "cofounder_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Who did it; empty = the app (a run publishing a post, a platform
    // refusing a permission, a teammate's removal disconnecting an account).
    actorUserId: text("actor_user_id"),
    action: text("action").$type<CofounderActivityAction>().notNull(),
    // What it was about (each empty when it wasn't about one).
    draftId: uuid("draft_id"),
    jobId: uuid("job_id"),
    connectionId: uuid("connection_id"),
    ruleId: uuid("rule_id"),
    planVersion: integer("plan_version"),
    // Why, as a code (lib/publishing/job-errors.ts, lib/social-errors.ts), when there is one.
    code: text("code"),
    // clock_timestamp(), not now(): one transaction can write several rows
    // (a draft changed, then its posts canceled), and they keep their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // Postgres refuses a row naming anything or anyone of another company.
    foreignKey({
      name: "cofounder_activity_actor_in_same_company_fk",
      columns: [table.companyId, table.actorUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "cofounder_activity_draft_in_same_company_fk",
      columns: [table.companyId, table.draftId],
      foreignColumns: [contentDrafts.companyId, contentDrafts.id],
    }),
    foreignKey({
      name: "cofounder_activity_job_in_same_company_fk",
      columns: [table.companyId, table.jobId],
      foreignColumns: [publishJobs.companyId, publishJobs.id],
    }),
    foreignKey({
      name: "cofounder_activity_connection_in_same_company_fk",
      columns: [table.companyId, table.connectionId],
      foreignColumns: [socialConnections.companyId, socialConnections.id],
    }),
    foreignKey({
      name: "cofounder_activity_rule_in_same_company_fk",
      columns: [table.companyId, table.ruleId],
      foreignColumns: [autopublishRules.companyId, autopublishRules.id],
    }),
    foreignKey({
      name: "cofounder_activity_plan_in_same_company_fk",
      columns: [table.companyId, table.planVersion],
      foreignColumns: [marketingPlans.companyId, marketingPlans.version],
    }),
    // The same list as lib/publishing/activity-actions.ts (a check proves they agree).
    check(
      "cofounder_activity_action_known",
      sql`${table.action} IN ('connected', 'disconnected', 'reconnect_needed', 'draft_approved', 'draft_rejected', 'draft_changed_after_approval', 'draft_archived', 'draft_restored', 'idea_planned', 'scheduled', 'canceled', 'publish_now', 'published', 'publish_failed', 'publish_delayed', 'needs_attention', 'marked_published', 'marked_not_published', 'retried', 'rule_created', 'rule_enabled', 'rule_disabled', 'plan_created')`,
    ),
    check("cofounder_activity_code_format", sql`${table.code} ~ '^[a-z0-9_]{1,60}$'`),
    // The queue page lists one company's newest, a draft's page its own.
    index("cofounder_activity_company_id_created_at_idx").on(table.companyId, table.createdAt),
    index("cofounder_activity_company_id_draft_id_created_at_idx").on(table.companyId, table.draftId, table.createdAt),
  ],
);
