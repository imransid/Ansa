CREATE TABLE "autopost_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"post_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'writing' NOT NULL,
	"kind" text NOT NULL,
	"topic" text NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"special_day" text DEFAULT '' NOT NULL,
	"draft_id" uuid,
	"skip_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopost_slots_company_post_at_unique" UNIQUE("company_id","post_at"),
	CONSTRAINT "autopost_slots_status_known" CHECK ("autopost_slots"."status" IN ('writing', 'scheduled', 'waiting_approval', 'skipped')),
	CONSTRAINT "autopost_slots_kind_known" CHECK ("autopost_slots"."kind" IN ('spotlight', 'behind_the_scenes', 'question', 'visit_us', 'tip', 'special_day')),
	CONSTRAINT "autopost_slots_topic_length" CHECK (char_length("autopost_slots"."topic") BETWEEN 1 AND 200),
	CONSTRAINT "autopost_slots_skip_reason_known" CHECK (("autopost_slots"."status" = 'skipped') = ("autopost_slots"."skip_reason" IS NOT NULL)),
	CONSTRAINT "autopost_slots_draft_once_written" CHECK ("autopost_slots"."status" NOT IN ('scheduled', 'waiting_approval') OR "autopost_slots"."draft_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT "companies_business_type_known";--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "autopost_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "autopost_frequency" text DEFAULT 'three_a_week' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "autopost_time" text DEFAULT '11:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "autopost_mode" text DEFAULT 'automatic' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "autopost_enabled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "autopost_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "autopost_slots" ADD CONSTRAINT "autopost_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopost_slots" ADD CONSTRAINT "autopost_slots_draft_in_same_company_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."content_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopost_slots_company_created_idx" ON "autopost_slots" USING btree ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_autopost_enabler_in_same_company_fk" FOREIGN KEY ("company_id","autopost_enabled_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_business_type_known" CHECK ("companies"."business_type" IN ('restaurant', 'cafe', 'bakery', 'takeaway', 'food_truck', 'bar', 'catering', 'shop', 'beauty', 'health', 'fitness', 'services', 'property', 'other'));--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_autopost_frequency_known" CHECK ("assistant_settings"."autopost_frequency" IN ('daily', 'three_a_week', 'weekly'));--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_autopost_mode_known" CHECK ("assistant_settings"."autopost_mode" IN ('automatic', 'ask_first'));--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_autopost_time_format" CHECK ("assistant_settings"."autopost_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_autopost_enabler" CHECK ("assistant_settings"."autopost_enabled" = ("assistant_settings"."autopost_enabled_by_user_id" IS NOT NULL AND "assistant_settings"."autopost_enabled_at" IS NOT NULL) AND (NOT "assistant_settings"."autopost_enabled" OR "assistant_settings"."time_zone" IS NOT NULL));