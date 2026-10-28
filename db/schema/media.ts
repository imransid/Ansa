import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
// The lists live in lib/ so the forms in the browser can read them too.
import type { MediaContentType, MediaGenerationJobStatus, MediaKind, MediaSource } from "../../lib/media/kinds";
import { users } from "./auth";
import { companies } from "./companies";
import { contentDrafts } from "./content-drafts";

// The Co-Founder's media library (step 39): images and videos a person
// uploaded or an image service made. Each file is in PRIVATE storage
// (lib/file-storage.ts) and only served by /api/media/<id> after a login
// and company check.
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    kind: text("kind").$type<MediaKind>().notNull(),
    source: text("source").$type<MediaSource>().notNull(),
    // From the file's own first bytes (lib/media/signatures.ts), never the browser's word.
    contentType: text("content_type").$type<MediaContentType>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // As the image's header states them; null for a video or an unreadable header.
    width: integer("width"),
    height: integer("height"),
    // Built from ids only: media/<companyId>/<assetId>.<extension>.
    storageKey: text("storage_key").notNull().unique(),
    // What the person called the file (uploads only), shown in lists. Never in the key.
    originalName: text("original_name"),
    // What the picture shows, for people who can't see it.
    altText: text("alt_text").notNull().default(""),
    // A generated one: the job that made it, and the service ("dev-stand-in").
    generationJobId: uuid("generation_job_id"),
    provider: text("provider"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The return type written out: the two tables (and content_drafts) point
  // at each other, which TypeScript can't infer in a circle.
  (table): PgTableExtraConfigValue[] => [
    // Lets drafts and generation jobs point at an asset of the same company.
    unique("media_assets_company_id_id_unique").on(table.companyId, table.id),
    // One asset per job.
    unique("media_assets_generation_job_id_unique").on(table.generationJobId),
    foreignKey({
      name: "media_assets_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "media_assets_job_in_same_company_fk",
      columns: [table.companyId, table.generationJobId],
      foreignColumns: [mediaGenerationJobs.companyId, mediaGenerationJobs.id],
    }),
    // The same lists as lib/media/kinds.ts (a check proves they agree).
    check("media_assets_kind_known", sql`${table.kind} IN ('image', 'video')`),
    check("media_assets_source_known", sql`${table.source} IN ('upload', 'generated')`),
    check("media_assets_content_type_known", sql`${table.contentType} IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4')`),
    check("media_assets_kind_matches_type", sql`(${table.kind} = 'video') = (${table.contentType} = 'video/mp4')`),
    // No key can point into another company's folder, or at another asset's file.
    check(
      "media_assets_storage_key_from_ids",
      sql`${table.storageKey} = 'media/' || ${table.companyId}::text || '/' || ${table.id}::text || '.' || CASE ${table.contentType} WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/webp' THEN 'webp' WHEN 'image/gif' THEN 'gif' WHEN 'video/mp4' THEN 'mp4' END`,
    ),
    // The limits of lib/media/limits.ts and lib/media/dimensions.ts, as a safety net.
    check("media_assets_size_range", sql`${table.sizeBytes} BETWEEN 1 AND 104857600`),
    check("media_assets_dimensions_together", sql`(${table.width} IS NULL) = (${table.height} IS NULL)`),
    check("media_assets_dimensions_range", sql`${table.width} BETWEEN 1 AND 100000 AND ${table.height} BETWEEN 1 AND 100000`),
    check("media_assets_alt_text_length", sql`char_length(${table.altText}) <= 1000`),
    check("media_assets_original_name_length", sql`char_length(${table.originalName}) BETWEEN 1 AND 200`),
    check("media_assets_provider_format", sql`${table.provider} ~ '^[a-z0-9-]{1,40}$'`),
    // An upload has its name and no job; a generated file its job and service, no name.
    check(
      "media_assets_upload_fields",
      sql`${table.source} <> 'upload' OR (${table.originalName} IS NOT NULL AND ${table.generationJobId} IS NULL AND ${table.provider} IS NULL)`,
    ),
    check(
      "media_assets_generated_fields",
      sql`${table.source} <> 'generated' OR (${table.originalName} IS NULL AND ${table.generationJobId} IS NOT NULL AND ${table.provider} IS NOT NULL)`,
    ),
    // The library lists one company's assets newest first, and a draft's
    // page its newest of one kind.
    index("media_assets_company_id_created_at_idx").on(table.companyId, table.createdAt),
    index("media_assets_company_id_kind_created_at_idx").on(table.companyId, table.kind, table.createdAt),
  ],
);

// An image or video asked of an image service (step 39): queued, then
// claimed by ONE run (db/media-generation-runs.ts), then succeeded (with its
// asset), failed (with a code) or canceled (while still queued).
export const mediaGenerationJobs = pgTable(
  "media_generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    kind: text("kind").$type<MediaKind>().notNull(),
    // Plain text, like the drafts it comes from: the company's own marketing.
    prompt: text("prompt").notNull(),
    // The service it was asked of (lib/media-generation.ts), when it was made.
    provider: text("provider").notNull(),
    status: text("status").$type<MediaGenerationJobStatus>().notNull().default("queued"),
    // Runs that claimed it. A run cut off leaves it "running"; 15 minutes
    // later another may claim it, until the third.
    attempts: integer("attempts").notNull().default(0),
    // Why it failed: a code of lib/media/error-codes.ts, never a message.
    lastError: text("last_error"),
    // The service's own id for a job it runs in the background.
    providerJobId: text("provider_job_id"),
    // What the service charged, when it said (null: unknown).
    costCents: integer("cost_cents"),
    // What it made: set only on success, in the transaction that saves it.
    // When the asset is deleted later, the link goes and asset_deleted_at says when.
    assetId: uuid("asset_id"),
    assetDeletedAt: timestamp("asset_deleted_at", { withTimezone: true }),
    // The draft to attach the result to (asked from a draft's page), and
    // the version of it the request was made at: the result is attached only
    // while the draft is still at that version, never over a change made since.
    draftId: uuid("draft_id"),
    draftVersion: integer("draft_version"),
    requestedByUserId: text("requested_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // When the latest run claimed it, and when it ended.
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table): PgTableExtraConfigValue[] => [
    unique("media_generation_jobs_company_id_id_unique").on(table.companyId, table.id),
    // Postgres refuses a person, a draft or an asset from another company.
    foreignKey({
      name: "media_generation_jobs_requester_in_same_company_fk",
      columns: [table.companyId, table.requestedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "media_generation_jobs_draft_in_same_company_fk",
      columns: [table.companyId, table.draftId],
      foreignColumns: [contentDrafts.companyId, contentDrafts.id],
    }),
    foreignKey({
      name: "media_generation_jobs_asset_in_same_company_fk",
      columns: [table.companyId, table.assetId],
      foreignColumns: [mediaAssets.companyId, mediaAssets.id],
    }),
    check("media_generation_jobs_kind_known", sql`${table.kind} IN ('image', 'video')`),
    check("media_generation_jobs_status_known", sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'canceled')`),
    check("media_generation_jobs_prompt_length", sql`char_length(${table.prompt}) BETWEEN 1 AND 2000`),
    check("media_generation_jobs_provider_format", sql`${table.provider} ~ '^[a-z0-9-]{1,40}$'`),
    check("media_generation_jobs_attempts_range", sql`${table.attempts} BETWEEN 0 AND 3`),
    check("media_generation_jobs_cost_positive", sql`${table.costCents} >= 0`),
    check("media_generation_jobs_provider_job_id_length", sql`char_length(${table.providerJobId}) BETWEEN 1 AND 200`),
    // A code, never a message (which could quote the prompt or an address).
    check("media_generation_jobs_last_error_is_code", sql`${table.lastError} ~ '^[a-z0-9_]{1,60}$'`),
    check("media_generation_jobs_failed_has_error", sql`(${table.status} = 'failed') = (${table.lastError} IS NOT NULL)`),
    // A failed (or unfinished) job never has an asset; a succeeded one has
    // one, unless it was deleted since.
    check("media_generation_jobs_asset_only_when_succeeded", sql`${table.assetId} IS NULL OR ${table.status} = 'succeeded'`),
    check(
      "media_generation_jobs_succeeded_has_asset",
      sql`${table.status} <> 'succeeded' OR ${table.assetId} IS NOT NULL OR ${table.assetDeletedAt} IS NOT NULL`,
    ),
    check("media_generation_jobs_asset_deleted_fields", sql`${table.assetDeletedAt} IS NULL OR (${table.status} = 'succeeded' AND ${table.assetId} IS NULL)`),
    check("media_generation_jobs_draft_version_with_draft", sql`(${table.draftId} IS NULL) = (${table.draftVersion} IS NULL)`),
    check("media_generation_jobs_draft_version_positive", sql`${table.draftVersion} >= 1`),
    // Waiting means never claimed; being made means claimed, with a start
    // time (a stuck run is told apart by it); the three ends have an end time.
    check("media_generation_jobs_queued_not_started", sql`${table.status} <> 'queued' OR (${table.startedAt} IS NULL AND ${table.attempts} = 0)`),
    check("media_generation_jobs_running_has_start", sql`${table.status} <> 'running' OR (${table.startedAt} IS NOT NULL AND ${table.attempts} >= 1)`),
    check("media_generation_jobs_finished_has_end", sql`(${table.status} IN ('succeeded', 'failed', 'canceled')) = (${table.finishedAt} IS NOT NULL)`),
    // The media page lists one company's jobs newest first; a draft's page
    // looks for its own.
    index("media_generation_jobs_company_id_created_at_idx").on(table.companyId, table.createdAt),
    index("media_generation_jobs_company_id_draft_id_idx").on(table.companyId, table.draftId),
    // One request at a time per draft, waiting or being made: a new one
    // ends a stuck one first (db/media-generation-jobs.ts).
    uniqueIndex("media_generation_jobs_one_open_per_draft")
      .on(table.companyId, table.draftId)
      .where(sql`${table.draftId} IS NOT NULL AND ${table.status} in ('queued', 'running')`),
    // The scheduled job looks for unfinished ones of every company
    // (db/stuck-work.ts); there are only ever a few of those.
    index("media_generation_jobs_unfinished_idx")
      .on(table.createdAt)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);
