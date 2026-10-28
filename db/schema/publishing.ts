import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
// The lists live in lib/ so the pages in the browser can read them too.
import type { PublishApprovalMode, PublishJobStatus } from "../../lib/publishing/kinds";
import type { SocialPlatform } from "../../lib/social-platforms";
import { users } from "./auth";
import { companies } from "./companies";
import { contentDrafts } from "./content-drafts";
import { socialConnections } from "./social";

// The Co-Founder's publishing queue (step 41): one row per post on its way
// to one account. Rows in Postgres, so a queued post survives any restart:
// whichever run comes next (right after scheduling, /api/cron/publish, the
// daily job) claims it in ONE UPDATE (db/publish-runs.ts) and checks again,
// right before sending, that it may still go out (lib/publishing/run-check.ts).
export const publishJobs = pgTable(
  "publish_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    draftId: uuid("draft_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    // When it should go out, as the owner picked it (UTC). "Now" is the moment it was scheduled.
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: text("status").$type<PublishJobStatus>().notNull().default("queued"),
    // owner: the draft's approval of approved_version. auto_rule: the rule below.
    approvalMode: text("approval_mode").$type<PublishApprovalMode>().notNull(),
    // The draft version this job may publish: any other is never sent.
    approvedVersion: integer("approved_version").notNull(),
    autopublishRuleId: uuid("autopublish_rule_id"),
    // Runs that claimed it since it was scheduled (or retried), less those
    // that gave their try back (held by the daily limit, too late to send).
    attempts: integer("attempts").notNull().default(0),
    // The earliest moment a run may claim it: scheduled_for, or later after
    // a platform asked to slow down or the company's daily limit was reached.
    runAfter: timestamp("run_after", { withTimezone: true }).notNull(),
    // When the latest run claimed it: "publishing" for 10+ minutes = cut off.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    // Made new at every claim. Only the run holding it may read the job to
    // send it and write what came of it (db/publish-runs.ts, heldBy): the
    // tries start again at 1 after a Retry, so a run that lost the job
    // could otherwise pass for the one holding it now.
    claimId: uuid("claim_id").notNull().defaultRandom(),
    // The platform's id of the post and its address (none from the stand-in).
    externalPostId: text("external_post_id"),
    externalUrl: text("external_url"),
    // Why it failed, needs attention or waits: a code of lib/publishing/job-errors.ts, never a message.
    lastError: text("last_error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // The latest try to read the post's numbers (step 42): when it was
    // claimed, and why it read none (a code of lib/metrics-errors.ts; empty
    // when it read some, or still runs). A failure never makes a snapshot.
    metricsAttemptedAt: timestamp("metrics_attempted_at", { withTimezone: true }),
    metricsError: text("metrics_error"),
    createdByUserId: text("created_by_user_id").notNull(),
    canceledByUserId: text("canceled_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Lets the activity log point at a job of the same company.
    unique("publish_jobs_company_id_id_unique").on(table.companyId, table.id),
    // Postgres refuses a draft, an account, a rule or a person of another company.
    foreignKey({
      name: "publish_jobs_draft_in_same_company_fk",
      columns: [table.companyId, table.draftId],
      foreignColumns: [contentDrafts.companyId, contentDrafts.id],
    }),
    foreignKey({
      name: "publish_jobs_connection_in_same_company_fk",
      columns: [table.companyId, table.connectionId],
      foreignColumns: [socialConnections.companyId, socialConnections.id],
    }),
    foreignKey({
      name: "publish_jobs_rule_in_same_company_fk",
      columns: [table.companyId, table.autopublishRuleId],
      foreignColumns: [autopublishRules.companyId, autopublishRules.id],
    }),
    foreignKey({
      name: "publish_jobs_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "publish_jobs_canceler_in_same_company_fk",
      columns: [table.companyId, table.canceledByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    // The same lists as lib/publishing/kinds.ts (a check proves they agree).
    check("publish_jobs_status_known", sql`${table.status} IN ('queued', 'publishing', 'published', 'failed', 'canceled', 'needs_attention')`),
    check("publish_jobs_approval_mode_known", sql`${table.approvalMode} IN ('owner', 'auto_rule')`),
    check("publish_jobs_rule_with_auto_mode", sql`(${table.approvalMode} = 'auto_rule') = (${table.autopublishRuleId} IS NOT NULL)`),
    check("publish_jobs_approved_version_positive", sql`${table.approvedVersion} >= 1`),
    // MAX_PUBLISH_ATTEMPTS in lib/publishing/limits.ts.
    check("publish_jobs_attempts_range", sql`${table.attempts} BETWEEN 0 AND 5`),
    // A code, never a message (which could quote the post or a token).
    check("publish_jobs_last_error_is_code", sql`${table.lastError} ~ '^[a-z0-9_]{1,60}$'`),
    check("publish_jobs_problem_has_error", sql`${table.status} NOT IN ('failed', 'needs_attention') OR ${table.lastError} IS NOT NULL`),
    check("publish_jobs_publishing_claimed", sql`${table.status} <> 'publishing' OR (${table.claimedAt} IS NOT NULL AND ${table.attempts} >= 1)`),
    check("publish_jobs_published_has_time", sql`(${table.status} = 'published') = (${table.publishedAt} IS NOT NULL)`),
    check("publish_jobs_post_only_when_published", sql`(${table.externalPostId} IS NULL AND ${table.externalUrl} IS NULL) OR ${table.status} = 'published'`),
    check("publish_jobs_external_post_id_format", sql`${table.externalPostId} ~ '^[A-Za-z0-9_:.-]{1,200}$'`),
    check("publish_jobs_external_url_https", sql`${table.externalUrl} ~ '^https://' AND char_length(${table.externalUrl}) <= 2000`),
    check("publish_jobs_canceler_only_when_canceled", sql`${table.canceledByUserId} IS NULL OR ${table.status} = 'canceled'`),
    // Numbers are read only for a post that went out, and a failure says when.
    check("publish_jobs_metrics_only_when_published", sql`${table.metricsAttemptedAt} IS NULL OR ${table.status} = 'published'`),
    check("publish_jobs_metrics_error_is_code", sql`${table.metricsError} ~ '^[a-z0-9_]{1,60}$'`),
    check("publish_jobs_metrics_error_with_attempt", sql`${table.metricsError} IS NULL OR ${table.metricsAttemptedAt} IS NOT NULL`),
    // One job per draft and account while it is on its way, out, or maybe
    // out: the same post can't be queued twice for one account. A failed or
    // canceled one leaves room for a new one.
    uniqueIndex("publish_jobs_one_live_per_draft_account")
      .on(table.companyId, table.draftId, table.connectionId)
      .where(sql`${table.status} IN ('queued', 'publishing', 'published', 'needs_attention')`),
    // The runners look for due jobs and stale claims of every company.
    index("publish_jobs_due_idx").on(table.runAfter).where(sql`${table.status} = 'queued'`),
    index("publish_jobs_publishing_idx").on(table.claimedAt).where(sql`${table.status} = 'publishing'`),
    // The queue lists one company's jobs by status, the calendar by time, a draft's page its own.
    index("publish_jobs_company_id_status_scheduled_for_idx").on(table.companyId, table.status, table.scheduledFor),
    index("publish_jobs_company_id_scheduled_for_idx").on(table.companyId, table.scheduledFor),
    index("publish_jobs_company_id_draft_id_idx").on(table.companyId, table.draftId),
    // Step 42: the collector looks for posts of the last 30 days of every
    // company; the Analytics page for one company's posts of a period.
    index("publish_jobs_published_at_idx").on(table.publishedAt).where(sql`${table.status} = 'published'`),
    index("publish_jobs_company_id_published_at_idx").on(table.companyId, table.publishedAt).where(sql`${table.status} = 'published'`),
  ],
);

// An owner's auto-publish rule (step 41): drafts of one platform (and one
// content pillar, or any) may be scheduled without an approval of their
// own, as long as they break no rule and make no claim an owner would have
// to check. Made switched OFF; only an owner's explicit confirm turns one
// on, and nothing in the code ever does. Checked again when each job runs.
export const autopublishRules = pgTable(
  "autopublish_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    platform: text("platform").$type<SocialPlatform>().notNull(),
    // A content pillar of the marketing plan, by name; "" = every pillar.
    pillar: text("pillar").notNull().default(""),
    enabled: boolean("enabled").notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull(),
    // The owner who turned it on, and when; empty while it is off.
    enabledByUserId: text("enabled_by_user_id"),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("autopublish_rules_company_id_id_unique").on(table.companyId, table.id),
    // One rule per platform and pillar, whatever the pillar's case.
    uniqueIndex("autopublish_rules_one_per_platform_pillar").on(table.companyId, table.platform, sql`lower(${table.pillar})`),
    foreignKey({
      name: "autopublish_rules_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "autopublish_rules_enabler_in_same_company_fk",
      columns: [table.companyId, table.enabledByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    check("autopublish_rules_platform_known", sql`${table.platform} IN ('linkedin', 'facebook', 'x', 'youtube')`),
    check("autopublish_rules_pillar_length", sql`char_length(${table.pillar}) <= 200`),
    check(
      "autopublish_rules_enabled_fields",
      sql`${table.enabled} = (${table.enabledByUserId} IS NOT NULL) AND ${table.enabled} = (${table.enabledAt} IS NOT NULL)`,
    ),
  ],
);
