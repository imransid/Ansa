CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"state_hash" text NOT NULL,
	"pkce_verifier_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "oauth_states_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "oauth_states_platform_known" CHECK ("oauth_states"."platform" IN ('linkedin', 'facebook', 'x', 'youtube')),
	CONSTRAINT "oauth_states_state_hash_format" CHECK ("oauth_states"."state_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "oauth_states_pkce_where_supported" CHECK (("oauth_states"."platform" IN ('x', 'youtube')) = ("oauth_states"."pkce_verifier_encrypted" IS NOT NULL)),
	CONSTRAINT "oauth_states_lifetime" CHECK ("oauth_states"."expires_at" > "oauth_states"."created_at" AND "oauth_states"."expires_at" <= "oauth_states"."created_at" + interval '10 minutes'),
	CONSTRAINT "oauth_states_used_after_created" CHECK ("oauth_states"."used_at" IS NULL OR "oauth_states"."used_at" >= "oauth_states"."created_at")
);
--> statement-breakpoint
CREATE TABLE "social_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"account_kind" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"access_expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_by_user_id" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_stand_in" boolean DEFAULT false NOT NULL,
	CONSTRAINT "social_connections_company_platform_account_unique" UNIQUE("company_id","platform","external_account_id"),
	CONSTRAINT "social_connections_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "social_connections_platform_known" CHECK ("social_connections"."platform" IN ('linkedin', 'facebook', 'x', 'youtube')),
	CONSTRAINT "social_connections_account_kind_known" CHECK ("social_connections"."account_kind" IN ('member', 'page', 'channel', 'account')),
	CONSTRAINT "social_connections_status_known" CHECK ("social_connections"."status" IN ('connected', 'needs_reauth', 'disconnected')),
	CONSTRAINT "social_connections_kind_fits_platform" CHECK (("social_connections"."platform" = 'linkedin' AND "social_connections"."account_kind" IN ('member', 'page')) OR ("social_connections"."platform" = 'facebook' AND "social_connections"."account_kind" = 'page') OR ("social_connections"."platform" = 'x' AND "social_connections"."account_kind" = 'account') OR ("social_connections"."platform" = 'youtube' AND "social_connections"."account_kind" = 'channel')),
	CONSTRAINT "social_connections_external_account_id_format" CHECK ("social_connections"."external_account_id" ~ '^[A-Za-z0-9_:.-]{1,200}$'),
	CONSTRAINT "social_connections_stand_in_id" CHECK ("social_connections"."is_stand_in" = ("social_connections"."external_account_id" = 'dev:stand-in')),
	CONSTRAINT "social_connections_display_name_length" CHECK (char_length("social_connections"."display_name") BETWEEN 1 AND 200),
	CONSTRAINT "social_connections_scopes_count" CHECK (cardinality("social_connections"."scopes") <= 50),
	CONSTRAINT "social_connections_last_error_is_code" CHECK ("social_connections"."last_error" ~ '^[a-z0-9_]{1,60}$'),
	CONSTRAINT "social_connections_connected_has_token" CHECK ("social_connections"."status" <> 'connected' OR ("social_connections"."access_token_encrypted" IS NOT NULL AND "social_connections"."disconnected_at" IS NULL)),
	CONSTRAINT "social_connections_needs_reauth_has_reason" CHECK ("social_connections"."status" <> 'needs_reauth' OR "social_connections"."last_error" IS NOT NULL),
	CONSTRAINT "social_connections_disconnected_fields" CHECK (("social_connections"."status" = 'disconnected') = ("social_connections"."disconnected_at" IS NOT NULL) AND ("social_connections"."status" <> 'disconnected' OR ("social_connections"."access_token_encrypted" IS NULL AND "social_connections"."refresh_token_encrypted" IS NULL AND "social_connections"."access_expires_at" IS NULL AND "social_connections"."refresh_expires_at" IS NULL))),
	CONSTRAINT "social_connections_refresh_expiry_with_token" CHECK ("social_connections"."refresh_expires_at" IS NULL OR "social_connections"."refresh_token_encrypted" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_in_same_company_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_connector_in_same_company_fk" FOREIGN KEY ("company_id","connected_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "social_connections_company_id_platform_idx" ON "social_connections" USING btree ("company_id","platform");