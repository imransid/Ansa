CREATE TABLE "usage_months" (
	"company_id" uuid NOT NULL,
	"month" date NOT NULL,
	"ai_replies" integer DEFAULT 0 NOT NULL,
	"call_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_months_pkey" PRIMARY KEY("company_id","month"),
	CONSTRAINT "usage_months_first_day" CHECK (extract(day from "usage_months"."month") = 1),
	CONSTRAINT "usage_months_not_negative" CHECK ("usage_months"."ai_replies" >= 0 AND "usage_months"."call_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_activity" DROP CONSTRAINT "assistant_activity_reason_known";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trial_ends_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_billing" ADD COLUMN "package" text DEFAULT 'business' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_months" ADD CONSTRAINT "usage_months_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_reason_known" CHECK ("assistant_activity"."reason" IN ('unsure', 'complaint', 'refund', 'asked_for_person', 'order', 'needs_decision', 'important_person', 'price_not_on_menu', 'refund_promise', 'unknown_link', 'unusable_answer', 'model_failed', 'model_unavailable', 'reply_limit', 'send_failed', 'order_change', 'order_unclear', 'call_message', 'package_used_up', 'not_in_package'));--> statement-breakpoint
ALTER TABLE "company_billing" ADD CONSTRAINT "company_billing_package_known" CHECK ("company_billing"."package" IN ('personal', 'business', 'pro'));