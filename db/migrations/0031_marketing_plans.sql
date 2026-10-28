CREATE TABLE "marketing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"goal_note" text,
	"plan" jsonb NOT NULL,
	"facts_used" jsonb NOT NULL,
	"knowledge_used" uuid[] NOT NULL,
	"used_support_trends" boolean NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_plans_company_id_version_unique" UNIQUE("company_id","version"),
	CONSTRAINT "marketing_plans_version_positive" CHECK ("marketing_plans"."version" >= 1),
	CONSTRAINT "marketing_plans_goal_note_length" CHECK (char_length("marketing_plans"."goal_note") BETWEEN 1 AND 1000),
	CONSTRAINT "marketing_plans_plan_is_object" CHECK (jsonb_typeof("marketing_plans"."plan") = 'object'),
	CONSTRAINT "marketing_plans_plan_size" CHECK (char_length("marketing_plans"."plan"::text) <= 200000),
	CONSTRAINT "marketing_plans_facts_used_is_array" CHECK (jsonb_typeof("marketing_plans"."facts_used") = 'array'),
	CONSTRAINT "marketing_plans_knowledge_used_count" CHECK (cardinality("marketing_plans"."knowledge_used") <= 10)
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "cofounder_uses_support_trends" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;