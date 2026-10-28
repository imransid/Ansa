import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
import type { PostMetricSource } from "../../lib/analytics/kinds";
import { companies } from "./companies";
import { publishJobs } from "./publishing";

// The numbers of the Co-Founder's published posts (step 42): one row per
// snapshot of one publish job, as its platform gave them at collected_at
// (services/post-metrics-collection.ts, about once a day for 30 days), or
// as `pnpm simulate:post-metrics` wrote them for a development stand-in's
// post. Never changed. Each number is NULL when the platform doesn't give
// it (lib/metric-definitions.ts says which), never 0 for unknown. The
// company's own marketing numbers: no customer data, not encrypted.
export const postMetrics = pgTable(
  "post_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    publishJobId: uuid("publish_job_id").notNull(),
    // When the platform was asked (or the simulation written).
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    // Impressions or views, as the platform defines them.
    views: integer("views"),
    reach: integer("reach"),
    reactions: integer("reactions"),
    comments: integer("comments"),
    shares: integer("shares"),
    clicks: integer("clicks"),
    videoViews: integer("video_views"),
    // platform: read from the platform. dev_simulated: written by the
    // development command, labeled "Simulated (development)" everywhere.
    source: text("source").$type<PostMetricSource>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Postgres refuses a snapshot of another company's post.
    foreignKey({
      name: "post_metrics_job_in_same_company_fk",
      columns: [table.companyId, table.publishJobId],
      foreignColumns: [publishJobs.companyId, publishJobs.id],
    }),
    // The same list as lib/analytics/kinds.ts (a check proves they agree).
    check("post_metrics_source_known", sql`${table.source} IN ('platform', 'dev_simulated')`),
    // A count is never negative; NULL (not given) passes.
    check(
      "post_metrics_counts_not_negative",
      sql`${table.views} >= 0 AND ${table.reach} >= 0 AND ${table.reactions} >= 0 AND ${table.comments} >= 0 AND ${table.shares} >= 0 AND ${table.clicks} >= 0 AND ${table.videoViews} >= 0`,
    ),
    // A snapshot holds at least one number: an answer without any is no snapshot.
    check(
      "post_metrics_has_a_number",
      sql`num_nonnulls(${table.views}, ${table.reach}, ${table.reactions}, ${table.comments}, ${table.shares}, ${table.clicks}, ${table.videoViews}) >= 1`,
    ),
    // The latest snapshot of each post (the Analytics page, the review).
    index("post_metrics_company_id_job_id_collected_at_idx").on(table.companyId, table.publishJobId, table.collectedAt.desc()),
  ],
);
