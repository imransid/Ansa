CREATE TABLE "device_pair_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "device_pair_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "device_pair_codes_hash_format" CHECK ("device_pair_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_pair_codes_lifetime" CHECK ("device_pair_codes"."expires_at" > "device_pair_codes"."created_at" AND "device_pair_codes"."expires_at" <= "device_pair_codes"."created_at" + interval '5 minutes')
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"paired_by_user_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"token_hash" text NOT NULL,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "devices_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "devices_name_length" CHECK (char_length("devices"."name") BETWEEN 1 AND 60),
	CONSTRAINT "devices_platform_known" CHECK ("devices"."platform" IN ('ios', 'android')),
	CONSTRAINT "devices_token_hash_format" CHECK ("devices"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "phone_presence_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"change" text NOT NULL,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "phone_presence_changes_change_known" CHECK ("phone_presence_changes"."change" IN ('away', 'back')),
	CONSTRAINT "phone_presence_changes_device_on_back" CHECK (("phone_presence_changes"."device_id" IS NOT NULL) = ("phone_presence_changes"."change" = 'back'))
);
--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "follow_phone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "phone_wait_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "away_set_by" text;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "away_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_pair_codes" ADD CONSTRAINT "device_pair_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pair_codes" ADD CONSTRAINT "device_pair_codes_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_pairer_in_same_company_fk" FOREIGN KEY ("company_id","paired_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_presence_changes" ADD CONSTRAINT "phone_presence_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_presence_changes" ADD CONSTRAINT "phone_presence_changes_device_in_same_company_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_pair_codes_expires_at_idx" ON "device_pair_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "devices_live_company_idx" ON "devices" USING btree ("company_id") WHERE "devices"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "phone_presence_changes_company_created_idx" ON "phone_presence_changes" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_settings_follow_phone_idx" ON "assistant_settings" USING btree ("company_id") WHERE "assistant_settings"."follow_phone";--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_phone_wait_known" CHECK ("assistant_settings"."phone_wait_minutes" IN (1, 5, 15, 30));--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_away_set_by_known" CHECK ("assistant_settings"."away_set_by" IN ('person', 'phone'));--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_away_set_by_only_while_away" CHECK ("assistant_settings"."away_set_by" IS NULL OR "assistant_settings"."away_since" IS NOT NULL);