CREATE TABLE "business_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"confirmed_value" text,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_source" text,
	"proposed_value" text,
	"proposed_source" text,
	"proposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_facts_company_id_topic_unique" UNIQUE("company_id","topic"),
	CONSTRAINT "business_facts_topic_known" CHECK ("business_facts"."topic" IN ('company_name', 'description', 'industry', 'products', 'services', 'target_customers', 'customer_problems', 'value_proposition', 'location', 'languages', 'goals', 'brand_voice', 'marketing_channels', 'publishing_frequency', 'competitors', 'campaign_budget', 'website', 'prices', 'offers_promotions', 'policies', 'positioning', 'social_accounts', 'content_preferences', 'visual_identity', 'words_to_avoid')),
	CONSTRAINT "business_facts_confirmed_source_known" CHECK ("business_facts"."confirmed_source" IN ('interview', 'owner', 'knowledge')),
	CONSTRAINT "business_facts_proposed_source_known" CHECK ("business_facts"."proposed_source" IN ('interview', 'knowledge')),
	CONSTRAINT "business_facts_confirmed_value_length" CHECK (char_length("business_facts"."confirmed_value") BETWEEN 1 AND 2000),
	CONSTRAINT "business_facts_proposed_value_length" CHECK (char_length("business_facts"."proposed_value") BETWEEN 1 AND 2000),
	CONSTRAINT "business_facts_confirmation_fields_together" CHECK (num_nonnulls("business_facts"."confirmed_value", "business_facts"."confirmed_by_user_id", "business_facts"."confirmed_at", "business_facts"."confirmed_source") IN (0, 4)),
	CONSTRAINT "business_facts_proposal_fields_together" CHECK (num_nonnulls("business_facts"."proposed_value", "business_facts"."proposed_source", "business_facts"."proposed_at") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "onboarding_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"author" text NOT NULL,
	"author_user_id" text,
	"body_encrypted" text NOT NULL,
	"ends_interview" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "onboarding_messages_author_known" CHECK ("onboarding_messages"."author" IN ('assistant', 'owner')),
	CONSTRAINT "onboarding_messages_owner_named" CHECK (("onboarding_messages"."author" = 'owner') = ("onboarding_messages"."author_user_id" IS NOT NULL)),
	CONSTRAINT "onboarding_messages_only_assistant_ends" CHECK ("onboarding_messages"."author" = 'assistant' OR NOT "onboarding_messages"."ends_interview")
);
--> statement-breakpoint
ALTER TABLE "business_facts" ADD CONSTRAINT "business_facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_facts" ADD CONSTRAINT "business_facts_confirmer_in_same_company_fk" FOREIGN KEY ("company_id","confirmed_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_messages" ADD CONSTRAINT "onboarding_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_messages" ADD CONSTRAINT "onboarding_messages_author_in_same_company_fk" FOREIGN KEY ("company_id","author_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_messages_company_id_created_at_idx" ON "onboarding_messages" USING btree ("company_id","created_at");