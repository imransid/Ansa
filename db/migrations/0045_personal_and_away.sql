CREATE TABLE "away_summary_reads" (
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "away_summary_reads_pk" PRIMARY KEY("company_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "assistant_settings" DROP CONSTRAINT "assistant_settings_hours_with_time_zone";--> statement-breakpoint
ALTER TABLE "assistant_activity" DROP CONSTRAINT "assistant_activity_reason_known";--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "answer_when" text DEFAULT 'always' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "away_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "away_hours" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "reply_grace_minutes" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "important" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assistant_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "away_summary_reads" ADD CONSTRAINT "away_summary_reads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "away_summary_reads" ADD CONSTRAINT "away_summary_reads_user_in_same_company_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_assistant_due_idx" ON "conversations" USING btree ("assistant_due_at");--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_answer_when_known" CHECK ("assistant_settings"."answer_when" IN ('always', 'when_away'));--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_away_hours_object" CHECK (jsonb_typeof("assistant_settings"."away_hours") = 'object');--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_reply_grace_known" CHECK ("assistant_settings"."reply_grace_minutes" IN (5, 10, 15, 30, 60));--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_hours_with_time_zone" CHECK (("assistant_settings"."opening_hours" IS NULL OR "assistant_settings"."time_zone" IS NOT NULL) AND ("assistant_settings"."away_hours" IS NULL OR "assistant_settings"."time_zone" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_reason_known" CHECK ("assistant_activity"."reason" IN ('unsure', 'complaint', 'refund', 'asked_for_person', 'order', 'needs_decision', 'important_person', 'price_not_on_menu', 'refund_promise', 'unknown_link', 'unusable_answer', 'model_failed', 'model_unavailable', 'reply_limit', 'send_failed'));