import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
// Relative paths on purpose: drizzle-kit reads this file outside Next.js.
// The lists live in lib/ so the forms in the browser can read them too.
import type { ContentDraftStatus, ContentFormat } from "../../lib/content-studio/formats";
import type { SocialPlatform } from "../../lib/social-platforms";
import { users } from "./auth";
import { companies } from "./companies";
import { marketingPlans } from "./marketing-plans";
// media.ts imports this file too (its jobs point at drafts). Both only read
// the other's tables inside the callbacks below, run once both are loaded.
import { mediaAssets } from "./media";

// The Co-Founder's content drafts (step 38): one post for one platform, in
// one format, written by the AI or by a person, checked against the
// platform's rules (lib/content-rules.ts) and approved by an owner before
// anything may publish it (step 41). Plain text on purpose, like the
// business facts it is written from: the company's own marketing, written
// to be published. Every content field is text, empty when unused, so the
// editor and the rules never handle null.
export const contentDrafts = pgTable(
  "content_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // Both set when the draft is made, never changed (another platform is another draft).
    platform: text("platform").$type<SocialPlatform>().notNull(),
    format: text("format").$type<ContentFormat>().notNull(),
    // The marketing plan's content pillar and campaign it belongs to, by name ("": none).
    pillar: text("pillar").notNull().default(""),
    campaign: text("campaign").notNull().default(""),
    topic: text("topic").notNull(),
    // YouTube's video title; "" on every other platform.
    title: text("title").notNull().default(""),
    // The post's text (YouTube: the description), without the call to
    // action and the hashtags, which are added after it when published.
    body: text("body").notNull().default(""),
    // Without their "#" (lib/content-studio/hashtags.ts).
    hashtags: text("hashtags").array().notNull().default(sql`'{}'::text[]`),
    callToAction: text("call_to_action").notNull().default(""),
    // For a post with an image (or a video's thumbnail): what to picture.
    imagePrompt: text("image_prompt").notNull().default(""),
    // For a video only: what is said and shown.
    videoScript: text("video_script").notNull().default(""),
    // The image (a post with an image) or video (a video) from the media
    // library (step 39). Attaching or removing it is a change of content.
    mediaAssetId: uuid("media_asset_id"),
    status: text("status").$type<ContentDraftStatus>().notNull().default("draft"),
    // 1 when made, +1 with every change of content (an edit or a new text
    // from the AI). An edit, an approval or a rejection names the version
    // the person saw, and is refused when the draft changed since.
    version: integer("version").notNull().default(1),
    // The version the AI last wrote (null: it never did). Another value
    // than `version` means someone changed the text by hand since.
    generatedVersion: integer("generated_version"),
    // [{ text, supported, fact_topics }]: the AI's list, marked by this
    // code (lib/content-studio/claims.ts), for the generated version.
    claims: jsonb("claims").notNull().default(sql`'[]'::jsonb`),
    // [{ topic, value }]: the confirmed facts the AI's request held, as they were.
    factsUsed: jsonb("facts_used").notNull().default(sql`'[]'::jsonb`),
    // The approved marketing articles the request held. No foreign key
    // (Postgres has none for array elements): one deleted since shows as deleted.
    knowledgeUsed: uuid("knowledge_used").array().notNull().default(sql`'{}'::uuid[]`),
    // The marketing plan version the request read (null: none).
    planVersion: integer("plan_version"),
    // The owner who ticked "I checked these claims" when approving.
    claimsAcknowledgedByUserId: text("claims_acknowledged_by_user_id"),
    claimsAcknowledgedAt: timestamp("claims_acknowledged_at", { withTimezone: true }),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedVersion: integer("approved_version"),
    // The last rejection, kept while the draft is reworked, until it is approved.
    rejectedByUserId: text("rejected_by_user_id"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionNote: text("rejection_note"),
    createdByUserId: text("created_by_user_id").notNull(),
    // Who last changed the content.
    updatedByUserId: text("updated_by_user_id").notNull(),
    // When it should go out: the calendar (step 41) sets it.
    plannedFor: timestamp("planned_for", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The return type written out: this table and media.ts point at each
  // other, which TypeScript can't infer in a circle.
  (table): PgTableExtraConfigValue[] => [
    // Lets the media library and the publishing queue (steps 39 and 41)
    // point at a draft of the same company.
    unique("content_drafts_company_id_id_unique").on(table.companyId, table.id),
    // Postgres refuses a person or a plan version from another company.
    foreignKey({
      name: "content_drafts_creator_in_same_company_fk",
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "content_drafts_updater_in_same_company_fk",
      columns: [table.companyId, table.updatedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "content_drafts_approver_in_same_company_fk",
      columns: [table.companyId, table.approvedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "content_drafts_rejecter_in_same_company_fk",
      columns: [table.companyId, table.rejectedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "content_drafts_acknowledger_in_same_company_fk",
      columns: [table.companyId, table.claimsAcknowledgedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "content_drafts_plan_in_same_company_fk",
      columns: [table.companyId, table.planVersion],
      foreignColumns: [marketingPlans.companyId, marketingPlans.version],
    }),
    // Postgres refuses another company's image or video.
    foreignKey({
      name: "content_drafts_media_in_same_company_fk",
      columns: [table.companyId, table.mediaAssetId],
      foreignColumns: [mediaAssets.companyId, mediaAssets.id],
    }),
    // The same lists as lib/ (a check proves they agree).
    check("content_drafts_platform_known", sql`${table.platform} IN ('linkedin', 'facebook', 'x', 'youtube')`),
    check("content_drafts_format_known", sql`${table.format} IN ('post', 'image_post', 'video')`),
    check(
      "content_drafts_status_known",
      sql`${table.status} IN ('idea', 'draft', 'approved', 'rejected', 'scheduled', 'published', 'failed', 'archived')`,
    ),
    // What lib/content-studio/draft-fields.ts keepUsedFields allows.
    check("content_drafts_youtube_takes_video", sql`${table.platform} <> 'youtube' OR ${table.format} = 'video'`),
    check("content_drafts_title_youtube_only", sql`${table.platform} = 'youtube' OR ${table.title} = ''`),
    check("content_drafts_script_video_only", sql`${table.format} = 'video' OR ${table.videoScript} = ''`),
    check("content_drafts_no_image_prompt_on_text_post", sql`${table.format} <> 'post' OR ${table.imagePrompt} = ''`),
    // A text post takes no image or video (db/content-draft-media.ts checks the kind).
    check("content_drafts_no_media_on_text_post", sql`${table.format} <> 'post' OR ${table.mediaAssetId} IS NULL`),
    // The limits of lib/content-studio/limits.ts, as a safety net under Zod.
    check("content_drafts_topic_length", sql`char_length(${table.topic}) BETWEEN 1 AND 500`),
    check("content_drafts_pillar_length", sql`char_length(${table.pillar}) <= 200`),
    check("content_drafts_campaign_length", sql`char_length(${table.campaign}) <= 200`),
    check("content_drafts_title_length", sql`char_length(${table.title}) <= 100`),
    check("content_drafts_body_length", sql`char_length(${table.body}) <= 63206`),
    check("content_drafts_call_to_action_length", sql`char_length(${table.callToAction}) <= 300`),
    check("content_drafts_image_prompt_length", sql`char_length(${table.imagePrompt}) <= 2000`),
    check("content_drafts_video_script_length", sql`char_length(${table.videoScript}) <= 10000`),
    check("content_drafts_hashtags_count", sql`cardinality(${table.hashtags}) <= 30`),
    check("content_drafts_hashtags_length", sql`char_length(array_to_string(${table.hashtags}, '')) <= 1800`),
    check("content_drafts_claims_is_array", sql`jsonb_typeof(${table.claims}) = 'array'`),
    check("content_drafts_claims_size", sql`char_length(${table.claims}::text) <= 50000`),
    check("content_drafts_facts_used_is_array", sql`jsonb_typeof(${table.factsUsed}) = 'array'`),
    check("content_drafts_knowledge_used_count", sql`cardinality(${table.knowledgeUsed}) <= 10`),
    check("content_drafts_version_positive", sql`${table.version} >= 1`),
    check("content_drafts_generated_version_range", sql`${table.generatedVersion} BETWEEN 1 AND ${table.version}`),
    // An idea is a topic with nothing written (or attached) yet.
    check(
      "content_drafts_idea_has_no_content",
      sql`${table.status} <> 'idea' OR (${table.title} = '' AND ${table.body} = '' AND ${table.callToAction} = '' AND ${table.imagePrompt} = '' AND ${table.videoScript} = '' AND cardinality(${table.hashtags}) = 0 AND ${table.mediaAssetId} IS NULL)`,
    ),
    // Approved = an owner approved exactly this version. Every change of
    // content clears the approval in the same UPDATE, so an approved draft
    // whose version moved on can't exist.
    check("content_drafts_approval_fields_together", sql`num_nonnulls(${table.approvedByUserId}, ${table.approvedAt}, ${table.approvedVersion}) IN (0, 3)`),
    check(
      "content_drafts_approved_has_approval",
      sql`${table.status} <> 'approved' OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedVersion} = ${table.version})`,
    ),
    check(
      "content_drafts_unapproved_has_no_approval",
      sql`${table.status} NOT IN ('idea', 'draft', 'rejected', 'archived') OR ${table.approvedByUserId} IS NULL`,
    ),
    check("content_drafts_approved_version_range", sql`${table.approvedVersion} BETWEEN 1 AND ${table.version}`),
    // "I checked these claims" belongs to the approval it was ticked for.
    check("content_drafts_acknowledgment_fields_together", sql`num_nonnulls(${table.claimsAcknowledgedByUserId}, ${table.claimsAcknowledgedAt}) IN (0, 2)`),
    check("content_drafts_acknowledgment_with_approval", sql`${table.claimsAcknowledgedAt} IS NULL OR ${table.approvedAt} IS NOT NULL`),
    check("content_drafts_rejection_fields_together", sql`num_nonnulls(${table.rejectedByUserId}, ${table.rejectedAt}) IN (0, 2)`),
    check("content_drafts_rejection_note_with_rejection", sql`${table.rejectionNote} IS NULL OR ${table.rejectedAt} IS NOT NULL`),
    check("content_drafts_rejection_note_length", sql`char_length(${table.rejectionNote}) BETWEEN 1 AND 500`),
    check("content_drafts_rejected_has_rejection", sql`${table.status} <> 'rejected' OR ${table.rejectedByUserId} IS NOT NULL`),
    // The studio lists one company's drafts, last changed first: by status, and all of them.
    index("content_drafts_company_id_status_updated_at_idx").on(table.companyId, table.status, table.updatedAt),
    index("content_drafts_company_id_updated_at_idx").on(table.companyId, table.updatedAt),
    // Which drafts use an image or video (the media library, and its delete rules).
    index("content_drafts_company_id_media_asset_id_idx").on(table.companyId, table.mediaAssetId),
  ],
);
