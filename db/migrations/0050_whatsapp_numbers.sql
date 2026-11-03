CREATE TABLE "whatsapp_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"waba_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text NOT NULL,
	"verified_name" text,
	"shared_with_app" boolean DEFAULT false NOT NULL,
	"token_encrypted" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"is_stand_in" boolean DEFAULT false NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_numbers_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "whatsapp_numbers_status_known" CHECK ("whatsapp_numbers"."status" IN ('connected', 'removed_in_whatsapp', 'disconnected')),
	CONSTRAINT "whatsapp_numbers_ids_shape" CHECK (("whatsapp_numbers"."is_stand_in" AND "whatsapp_numbers"."waba_id" LIKE 'stand-in:%' AND "whatsapp_numbers"."phone_number_id" LIKE 'stand-in:%')
      OR (NOT "whatsapp_numbers"."is_stand_in" AND "whatsapp_numbers"."waba_id" ~ '^[0-9]{1,40}$' AND "whatsapp_numbers"."phone_number_id" ~ '^[0-9]{1,40}$')),
	CONSTRAINT "whatsapp_numbers_display_phone_length" CHECK (char_length("whatsapp_numbers"."display_phone_number") BETWEEN 1 AND 40),
	CONSTRAINT "whatsapp_numbers_verified_name_length" CHECK ("whatsapp_numbers"."verified_name" IS NULL OR char_length("whatsapp_numbers"."verified_name") BETWEEN 1 AND 200),
	CONSTRAINT "whatsapp_numbers_token" CHECK (("whatsapp_numbers"."token_encrypted" IS NOT NULL) = (NOT "whatsapp_numbers"."is_stand_in" AND "whatsapp_numbers"."status" <> 'disconnected')),
	CONSTRAINT "whatsapp_numbers_disconnected_at" CHECK (("whatsapp_numbers"."status" = 'disconnected') = ("whatsapp_numbers"."disconnected_at" IS NOT NULL)),
	CONSTRAINT "whatsapp_numbers_last_error_code" CHECK ("whatsapp_numbers"."last_error" IS NULL OR "whatsapp_numbers"."last_error" ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_channel_known";--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_connector_in_same_company_fk" FOREIGN KEY ("company_id","connected_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_numbers_live_number_unique" ON "whatsapp_numbers" USING btree ("phone_number_id") WHERE "whatsapp_numbers"."status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_numbers_live_company_unique" ON "whatsapp_numbers" USING btree ("company_id") WHERE "whatsapp_numbers"."status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX "whatsapp_numbers_waba_idx" ON "whatsapp_numbers" USING btree ("waba_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_channel_known" CHECK ("contacts"."channel" IN ('telegram', 'messenger', 'whatsapp', 'phone', 'email', 'stand_in'));