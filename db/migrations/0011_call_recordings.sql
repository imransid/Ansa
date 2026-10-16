CREATE TYPE "public"."call_recording_status" AS ENUM('none', 'stored', 'failed');--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "recording_status" "call_recording_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "recording_key" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "recording_content_type" text;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_recording_fields_match_status" CHECK (("calls"."recording_status" = 'stored') = ("calls"."recording_key" IS NOT NULL AND "calls"."recording_content_type" IS NOT NULL));