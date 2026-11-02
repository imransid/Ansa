CREATE TABLE "phone_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"line" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"messages_taken" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "phone_calls_line_known" CHECK ("phone_calls"."line" IN ('practice')),
	CONSTRAINT "phone_calls_ends_after_start" CHECK ("phone_calls"."ended_at" IS NULL OR "phone_calls"."ended_at" >= "phone_calls"."started_at"),
	CONSTRAINT "phone_calls_messages_taken_not_negative" CHECK ("phone_calls"."messages_taken" >= 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_activity" DROP CONSTRAINT "assistant_activity_reason_known";--> statement-breakpoint
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_calls" ADD CONSTRAINT "phone_calls_conversation_in_same_company_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_calls_one_live_per_conversation" ON "phone_calls" USING btree ("company_id","conversation_id") WHERE "phone_calls"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "phone_calls_company_started_idx" ON "phone_calls" USING btree ("company_id","started_at");--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_reason_known" CHECK ("assistant_activity"."reason" IN ('unsure', 'complaint', 'refund', 'asked_for_person', 'order', 'needs_decision', 'important_person', 'price_not_on_menu', 'refund_promise', 'unknown_link', 'unusable_answer', 'model_failed', 'model_unavailable', 'reply_limit', 'send_failed', 'order_change', 'order_unclear', 'call_message'));