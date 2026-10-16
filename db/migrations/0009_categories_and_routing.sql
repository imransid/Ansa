CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_company_id_name_unique" UNIQUE("company_id","name"),
	CONSTRAINT "categories_company_id_id_unique" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "user_categories" (
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_categories_pk" PRIMARY KEY("user_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "assigned_automatically" boolean;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "routed_to_user_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_categories" ADD CONSTRAINT "user_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_categories" ADD CONSTRAINT "user_categories_user_in_same_company_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_categories" ADD CONSTRAINT "user_categories_category_in_same_company_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."categories"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_company_id_lower_name_unique" ON "categories" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE INDEX "user_categories_company_id_category_id_idx" ON "user_categories" USING btree ("company_id","category_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_routed_to_in_same_company_fk" FOREIGN KEY ("company_id","routed_to_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_in_same_company_fk" FOREIGN KEY ("company_id","category") REFERENCES "public"."categories"("company_id","name") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
-- Added by hand: tickets assigned before this step were assigned by a person.
UPDATE "tickets" SET "assigned_automatically" = false WHERE "assigned_to_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignment_origin_matches_assignee" CHECK (("tickets"."assigned_to_user_id" IS NULL) = ("tickets"."assigned_automatically" IS NULL));