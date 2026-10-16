CREATE TYPE "public"."email_delivery_problem" AS ENUM('bounced', 'complained');--> statement-breakpoint
ALTER TABLE "outgoing_emails" ADD COLUMN "delivery_problem" "email_delivery_problem";--> statement-breakpoint
ALTER TABLE "outgoing_emails" ADD COLUMN "delivery_problem_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "outgoing_emails_provider_message_id_idx" ON "outgoing_emails" USING btree ("provider_message_id");