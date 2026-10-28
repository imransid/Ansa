ALTER TYPE "public"."email_delivery_problem" ADD VALUE 'suppressed';--> statement-breakpoint
ALTER TYPE "public"."email_delivery_problem" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ai_error_class" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "reply_to_address" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "body_from_html" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "attachment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "attachment_names_encrypted" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "processing_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "calls_unfinished_analysis_idx" ON "calls" USING btree ("created_at") WHERE "calls"."analysis_status" in ('pending', 'analyzing');--> statement-breakpoint
CREATE INDEX "inbound_emails_unfinished_idx" ON "inbound_emails" USING btree ("received_at") WHERE "inbound_emails"."status" in ('received', 'processing');--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_ai_error_class_is_a_name" CHECK ("calls"."ai_error_class" IS NULL OR "calls"."ai_error_class" ~ '^[A-Za-z0-9_]{1,64}$');--> statement-breakpoint
-- Hand-added before the check below: emails already "processing" get their last
-- change as start time, so the check holds and a stuck one can be claimed again.
UPDATE "inbound_emails" SET "processing_started_at" = "updated_at" WHERE "status" = 'processing';--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_processing_has_start_time" CHECK ("inbound_emails"."status" <> 'processing' OR "inbound_emails"."processing_started_at" IS NOT NULL);