-- Added by hand (comment only): no backfill is needed. Calls decided before
-- this step kept no confirming sentence (ai_evidence_encrypted stays empty),
-- and no call was escalated yet. The new enum values are not used in this
-- file: drizzle-kit runs every pending migration in one transaction, and
-- Postgres refuses a new enum value until that commits.
ALTER TYPE "public"."ticket_channel" ADD VALUE 'manual';--> statement-breakpoint
ALTER TYPE "public"."ticket_activity_kind" ADD VALUE 'created';--> statement-breakpoint
ALTER TYPE "public"."ticket_activity_kind" ADD VALUE 'escalated';--> statement-breakpoint
ALTER TYPE "public"."ticket_activity_kind" ADD VALUE 'subject_changed';--> statement-breakpoint
ALTER TYPE "public"."ticket_activity_kind" ADD VALUE 'customer_name_changed';--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ai_evidence_encrypted" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "escalated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_escalator_in_same_company_fk" FOREIGN KEY ("company_id","escalated_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_ai_evidence_only_when_solved" CHECK ("calls"."ai_evidence_encrypted" IS NULL OR "calls"."ai_outcome" = 'solved');--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_escalation_fields_together" CHECK (("calls"."escalated_by_user_id" IS NULL) = ("calls"."escalated_at" IS NULL));--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_escalated_only_when_ai_solved" CHECK ("calls"."escalated_at" IS NULL OR ("calls"."analysis_status" = 'decided' AND "calls"."ai_outcome" = 'solved'));