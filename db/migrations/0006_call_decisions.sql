CREATE TYPE "public"."call_analysis_status" AS ENUM('pending', 'analyzing', 'decided');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('solved', 'needs_human');--> statement-breakpoint
CREATE TYPE "public"."call_decision_source" AS ENUM('model', 'rule');--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "analysis_status" "call_analysis_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "analysis_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ai_outcome" "call_outcome";--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ai_decision_source" "call_decision_source";--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ai_reason_code" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ai_issue_encrypted" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "ai_explanation_encrypted" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_decision_fields_match_status" CHECK (("calls"."analysis_status" = 'decided') = ("calls"."ai_outcome" IS NOT NULL AND "calls"."ai_decision_source" IS NOT NULL AND "calls"."ai_reason_code" IS NOT NULL AND "calls"."decided_at" IS NOT NULL));