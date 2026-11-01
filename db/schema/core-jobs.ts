import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// The new backend's job queue (core/internal/jobs, the rewrite): work that
// must survive a restart (answer this message, send this post), one row per
// job, claimed with FOR UPDATE SKIP LOCKED so several workers share it. The
// payload holds ids only, never a customer's words (docs/backend/security.md).
export const coreJobs = pgTable(
  "core_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("queued"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    // Why the last try failed: a code, never a message.
    lastErrorCode: text("last_error_code"),
    // The same work queued twice is one job while it waits or runs.
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("core_jobs_due_idx").on(table.status, table.runAfter),
    uniqueIndex("core_jobs_one_waiting_per_key")
      .on(table.companyId, table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL AND ${table.status} IN ('queued', 'running')`),
    check("core_jobs_status_known", sql`${table.status} IN ('queued', 'running', 'done', 'failed')`),
    check("core_jobs_kind_format", sql`${table.kind} ~ '^[a-z][a-z0-9_.]{1,60}$'`),
    check("core_jobs_attempts_range", sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.maxAttempts} AND ${table.maxAttempts} BETWEEN 1 AND 20`),
    check("core_jobs_error_code_format", sql`${table.lastErrorCode} IS NULL OR ${table.lastErrorCode} ~ '^[a-z0-9_]{1,60}$'`),
  ],
);
