CREATE TABLE "assistant_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'on' NOT NULL,
	"reply_mode" text DEFAULT 'automatic' NOT NULL,
	"holding_reply" text DEFAULT 'Thank you for your message. Our team will get back to you as soon as possible.' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"takes_orders" boolean DEFAULT true NOT NULL,
	"time_zone" text,
	"opening_hours" jsonb,
	"delivery" boolean DEFAULT false NOT NULL,
	"delivery_note" text DEFAULT '' NOT NULL,
	"pickup" boolean DEFAULT true NOT NULL,
	"payment_note" text DEFAULT '' NOT NULL,
	"currency" text,
	"public_phone" text,
	"alert_by_email" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_settings_status_known" CHECK ("assistant_settings"."status" IN ('on', 'paused')),
	CONSTRAINT "assistant_settings_reply_mode_known" CHECK ("assistant_settings"."reply_mode" IN ('automatic', 'ask_first')),
	CONSTRAINT "assistant_settings_holding_reply_length" CHECK (char_length("assistant_settings"."holding_reply") BETWEEN 1 AND 500),
	CONSTRAINT "assistant_settings_instructions_length" CHECK (char_length("assistant_settings"."instructions") <= 2000),
	CONSTRAINT "assistant_settings_delivery_note_length" CHECK (char_length("assistant_settings"."delivery_note") <= 500),
	CONSTRAINT "assistant_settings_payment_note_length" CHECK (char_length("assistant_settings"."payment_note") <= 500),
	CONSTRAINT "assistant_settings_public_phone_length" CHECK (char_length("assistant_settings"."public_phone") BETWEEN 1 AND 40),
	CONSTRAINT "assistant_settings_currency_format" CHECK ("assistant_settings"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "assistant_settings_hours_with_time_zone" CHECK (num_nonnulls("assistant_settings"."time_zone", "assistant_settings"."opening_hours") IN (0, 2)),
	CONSTRAINT "assistant_settings_time_zone_length" CHECK (char_length("assistant_settings"."time_zone") BETWEEN 1 AND 64),
	CONSTRAINT "assistant_settings_opening_hours_object" CHECK (jsonb_typeof("assistant_settings"."opening_hours") = 'object')
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "kind" text DEFAULT 'business' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "setup_progress" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "setup_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_updater_in_same_company_fk" FOREIGN KEY ("company_id","updated_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_kind_known" CHECK ("companies"."kind" IN ('business', 'personal'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_business_type_known" CHECK ("companies"."business_type" IN ('restaurant', 'cafe', 'bakery', 'takeaway', 'food_truck', 'bar', 'catering', 'other'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_setup_progress_range" CHECK ("companies"."setup_progress" BETWEEN 0 AND 6);