CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"storage_key" text NOT NULL,
	"original_name" text,
	"alt_text" text DEFAULT '' NOT NULL,
	"generation_job_id" uuid,
	"provider" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_assets_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "media_assets_generation_job_id_unique" UNIQUE("generation_job_id"),
	CONSTRAINT "media_assets_kind_known" CHECK ("media_assets"."kind" IN ('image', 'video')),
	CONSTRAINT "media_assets_source_known" CHECK ("media_assets"."source" IN ('upload', 'generated')),
	CONSTRAINT "media_assets_content_type_known" CHECK ("media_assets"."content_type" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4')),
	CONSTRAINT "media_assets_kind_matches_type" CHECK (("media_assets"."kind" = 'video') = ("media_assets"."content_type" = 'video/mp4')),
	CONSTRAINT "media_assets_storage_key_from_ids" CHECK ("media_assets"."storage_key" = 'media/' || "media_assets"."company_id"::text || '/' || "media_assets"."id"::text || '.' || CASE "media_assets"."content_type" WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/webp' THEN 'webp' WHEN 'image/gif' THEN 'gif' WHEN 'video/mp4' THEN 'mp4' END),
	CONSTRAINT "media_assets_size_range" CHECK ("media_assets"."size_bytes" BETWEEN 1 AND 104857600),
	CONSTRAINT "media_assets_dimensions_together" CHECK (("media_assets"."width" IS NULL) = ("media_assets"."height" IS NULL)),
	CONSTRAINT "media_assets_dimensions_range" CHECK ("media_assets"."width" BETWEEN 1 AND 100000 AND "media_assets"."height" BETWEEN 1 AND 100000),
	CONSTRAINT "media_assets_alt_text_length" CHECK (char_length("media_assets"."alt_text") <= 1000),
	CONSTRAINT "media_assets_original_name_length" CHECK (char_length("media_assets"."original_name") BETWEEN 1 AND 200),
	CONSTRAINT "media_assets_provider_format" CHECK ("media_assets"."provider" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "media_assets_upload_fields" CHECK ("media_assets"."source" <> 'upload' OR ("media_assets"."original_name" IS NOT NULL AND "media_assets"."generation_job_id" IS NULL AND "media_assets"."provider" IS NULL)),
	CONSTRAINT "media_assets_generated_fields" CHECK ("media_assets"."source" <> 'generated' OR ("media_assets"."original_name" IS NULL AND "media_assets"."generation_job_id" IS NOT NULL AND "media_assets"."provider" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "media_generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_job_id" text,
	"cost_cents" integer,
	"asset_id" uuid,
	"asset_deleted_at" timestamp with time zone,
	"draft_id" uuid,
	"requested_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "media_generation_jobs_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "media_generation_jobs_kind_known" CHECK ("media_generation_jobs"."kind" IN ('image', 'video')),
	CONSTRAINT "media_generation_jobs_status_known" CHECK ("media_generation_jobs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "media_generation_jobs_prompt_length" CHECK (char_length("media_generation_jobs"."prompt") BETWEEN 1 AND 2000),
	CONSTRAINT "media_generation_jobs_provider_format" CHECK ("media_generation_jobs"."provider" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "media_generation_jobs_attempts_range" CHECK ("media_generation_jobs"."attempts" BETWEEN 0 AND 3),
	CONSTRAINT "media_generation_jobs_cost_positive" CHECK ("media_generation_jobs"."cost_cents" >= 0),
	CONSTRAINT "media_generation_jobs_provider_job_id_length" CHECK (char_length("media_generation_jobs"."provider_job_id") BETWEEN 1 AND 200),
	CONSTRAINT "media_generation_jobs_last_error_is_code" CHECK ("media_generation_jobs"."last_error" ~ '^[a-z0-9_]{1,60}$'),
	CONSTRAINT "media_generation_jobs_failed_has_error" CHECK (("media_generation_jobs"."status" = 'failed') = ("media_generation_jobs"."last_error" IS NOT NULL)),
	CONSTRAINT "media_generation_jobs_asset_only_when_succeeded" CHECK ("media_generation_jobs"."asset_id" IS NULL OR "media_generation_jobs"."status" = 'succeeded'),
	CONSTRAINT "media_generation_jobs_succeeded_has_asset" CHECK ("media_generation_jobs"."status" <> 'succeeded' OR "media_generation_jobs"."asset_id" IS NOT NULL OR "media_generation_jobs"."asset_deleted_at" IS NOT NULL),
	CONSTRAINT "media_generation_jobs_asset_deleted_fields" CHECK ("media_generation_jobs"."asset_deleted_at" IS NULL OR ("media_generation_jobs"."status" = 'succeeded' AND "media_generation_jobs"."asset_id" IS NULL)),
	CONSTRAINT "media_generation_jobs_queued_not_started" CHECK ("media_generation_jobs"."status" <> 'queued' OR ("media_generation_jobs"."started_at" IS NULL AND "media_generation_jobs"."attempts" = 0)),
	CONSTRAINT "media_generation_jobs_running_has_start" CHECK ("media_generation_jobs"."status" <> 'running' OR ("media_generation_jobs"."started_at" IS NOT NULL AND "media_generation_jobs"."attempts" >= 1)),
	CONSTRAINT "media_generation_jobs_finished_has_end" CHECK (("media_generation_jobs"."status" IN ('succeeded', 'failed', 'canceled')) = ("media_generation_jobs"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "content_drafts" DROP CONSTRAINT "content_drafts_idea_has_no_content";--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_job_in_same_company_fk" FOREIGN KEY ("company_id","generation_job_id") REFERENCES "public"."media_generation_jobs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_generation_jobs" ADD CONSTRAINT "media_generation_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_generation_jobs" ADD CONSTRAINT "media_generation_jobs_requester_in_same_company_fk" FOREIGN KEY ("company_id","requested_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_generation_jobs" ADD CONSTRAINT "media_generation_jobs_draft_in_same_company_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."content_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_generation_jobs" ADD CONSTRAINT "media_generation_jobs_asset_in_same_company_fk" FOREIGN KEY ("company_id","asset_id") REFERENCES "public"."media_assets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_company_id_created_at_idx" ON "media_assets" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_company_id_kind_created_at_idx" ON "media_assets" USING btree ("company_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "media_generation_jobs_company_id_created_at_idx" ON "media_generation_jobs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "media_generation_jobs_company_id_draft_id_idx" ON "media_generation_jobs" USING btree ("company_id","draft_id");--> statement-breakpoint
CREATE INDEX "media_generation_jobs_unfinished_idx" ON "media_generation_jobs" USING btree ("created_at") WHERE "media_generation_jobs"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_media_in_same_company_fk" FOREIGN KEY ("company_id","media_asset_id") REFERENCES "public"."media_assets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_drafts_company_id_media_asset_id_idx" ON "content_drafts" USING btree ("company_id","media_asset_id");--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_no_media_on_text_post" CHECK ("content_drafts"."format" <> 'post' OR "content_drafts"."media_asset_id" IS NULL);--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_idea_has_no_content" CHECK ("content_drafts"."status" <> 'idea' OR ("content_drafts"."title" = '' AND "content_drafts"."body" = '' AND "content_drafts"."call_to_action" = '' AND "content_drafts"."image_prompt" = '' AND "content_drafts"."video_script" = '' AND cardinality("content_drafts"."hashtags") = 0 AND "content_drafts"."media_asset_id" IS NULL));