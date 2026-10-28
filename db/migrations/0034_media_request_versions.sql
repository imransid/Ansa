ALTER TABLE "media_generation_jobs" ADD COLUMN "draft_version" integer;--> statement-breakpoint
-- Added by hand: a request made from a draft before this migration records the
-- draft's version now, the closest to "attach it whenever it is made".
UPDATE "media_generation_jobs" AS "job" SET "draft_version" = "draft"."version" FROM "content_drafts" AS "draft" WHERE "draft"."company_id" = "job"."company_id" AND "draft"."id" = "job"."draft_id";--> statement-breakpoint
-- Added by hand: a draft with more than one open request (a new one asked over a
-- stuck one) keeps the newest; the older ones end as superseded, before the
-- unique index below allows only one.
UPDATE "media_generation_jobs" AS "older" SET "status" = 'failed', "last_error" = 'superseded', "finished_at" = now() WHERE "older"."draft_id" IS NOT NULL AND "older"."status" IN ('queued', 'running') AND EXISTS (SELECT 1 FROM "media_generation_jobs" AS "newer" WHERE "newer"."company_id" = "older"."company_id" AND "newer"."draft_id" = "older"."draft_id" AND "newer"."status" IN ('queued', 'running') AND ("newer"."created_at", "newer"."id") > ("older"."created_at", "older"."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "media_generation_jobs_one_open_per_draft" ON "media_generation_jobs" USING btree ("company_id","draft_id") WHERE "media_generation_jobs"."draft_id" IS NOT NULL AND "media_generation_jobs"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "media_generation_jobs" ADD CONSTRAINT "media_generation_jobs_draft_version_with_draft" CHECK (("media_generation_jobs"."draft_id" IS NULL) = ("media_generation_jobs"."draft_version" IS NULL));--> statement-breakpoint
ALTER TABLE "media_generation_jobs" ADD CONSTRAINT "media_generation_jobs_draft_version_positive" CHECK ("media_generation_jobs"."draft_version" >= 1);
