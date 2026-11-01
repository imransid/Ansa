CREATE TABLE "channel_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"account_telegram_id" text NOT NULL,
	"account_chat_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"is_stand_in" boolean DEFAULT false NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_connections_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "channel_connections_channel_known" CHECK ("channel_connections"."channel" IN ('telegram')),
	CONSTRAINT "channel_connections_status_known" CHECK ("channel_connections"."status" IN ('connected', 'cannot_reply', 'removed_in_telegram', 'disconnected')),
	CONSTRAINT "channel_connections_external_id_length" CHECK (char_length("channel_connections"."external_id") BETWEEN 1 AND 200),
	CONSTRAINT "channel_connections_account_ids_digits" CHECK ("channel_connections"."account_telegram_id" ~ '^-?[0-9]{1,20}$' AND "channel_connections"."account_chat_id" ~ '^-?[0-9]{1,20}$'),
	CONSTRAINT "channel_connections_display_name_length" CHECK (char_length("channel_connections"."display_name") BETWEEN 1 AND 200),
	CONSTRAINT "channel_connections_stand_in_id" CHECK ("channel_connections"."is_stand_in" = ("channel_connections"."external_id" LIKE 'stand-in:%')),
	CONSTRAINT "channel_connections_disconnected_at" CHECK (("channel_connections"."status" = 'disconnected') = ("channel_connections"."disconnected_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by_telegram_id" text,
	"claimed_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	CONSTRAINT "telegram_link_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "telegram_link_codes_hash_format" CHECK ("telegram_link_codes"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "telegram_link_codes_lifetime" CHECK ("telegram_link_codes"."expires_at" > "telegram_link_codes"."created_at" AND "telegram_link_codes"."expires_at" <= "telegram_link_codes"."created_at" + interval '10 minutes'),
	CONSTRAINT "telegram_link_codes_claim_fields_together" CHECK (num_nonnulls("telegram_link_codes"."claimed_by_telegram_id", "telegram_link_codes"."claimed_at") IN (0, 2) AND ("telegram_link_codes"."used_at" IS NULL OR "telegram_link_codes"."claimed_at" IS NOT NULL)),
	CONSTRAINT "telegram_link_codes_claimer_digits" CHECK ("telegram_link_codes"."claimed_by_telegram_id" ~ '^-?[0-9]{1,20}$')
);
--> statement-breakpoint
CREATE TABLE "telegram_pending_connections" (
	"external_id" text PRIMARY KEY NOT NULL,
	"account_telegram_id" text NOT NULL,
	"account_chat_id" text NOT NULL,
	"display_name" text NOT NULL,
	"can_reply" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_pending_connections_ids_digits" CHECK ("telegram_pending_connections"."account_telegram_id" ~ '^-?[0-9]{1,20}$' AND "telegram_pending_connections"."account_chat_id" ~ '^-?[0-9]{1,20}$'),
	CONSTRAINT "telegram_pending_connections_external_id_length" CHECK (char_length("telegram_pending_connections"."external_id") BETWEEN 1 AND 200),
	CONSTRAINT "telegram_pending_connections_display_name_length" CHECK (char_length("telegram_pending_connections"."display_name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_author_known";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "send_error" text;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_connector_in_same_company_fk" FOREIGN KEY ("company_id","connected_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_live_external_unique" ON "channel_connections" USING btree ("channel","external_id") WHERE "channel_connections"."status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_live_company_unique" ON "channel_connections" USING btree ("company_id","channel") WHERE "channel_connections"."status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX "channel_connections_company_idx" ON "channel_connections" USING btree ("company_id","connected_at");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_claimer_idx" ON "telegram_link_codes" USING btree ("claimed_by_telegram_id","claimed_at");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_expires_at_idx" ON "telegram_link_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "telegram_pending_connections_account_idx" ON "telegram_pending_connections" USING btree ("account_telegram_id","received_at");--> statement-breakpoint
CREATE INDEX "telegram_pending_connections_received_at_idx" ON "telegram_pending_connections" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_send_error_known" CHECK ("messages"."send_error" IN ('not_connected', 'cannot_reply', 'reply_window_closed', 'refused', 'bot_rejected', 'rate_limited', 'no_answer'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_send_error_only_when_not_sent" CHECK ("messages"."send_error" IS NULL OR "messages"."send_status" IN ('failed', 'unclear'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_known" CHECK ("messages"."author" IN ('customer', 'assistant', 'person', 'business_account'));