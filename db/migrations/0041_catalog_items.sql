CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"unavailable_until" timestamp with time zone,
	"position" integer NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_category_length" CHECK (char_length("catalog_items"."category") <= 60),
	CONSTRAINT "catalog_items_name_length" CHECK (char_length("catalog_items"."name") BETWEEN 1 AND 120),
	CONSTRAINT "catalog_items_description_length" CHECK (char_length("catalog_items"."description") <= 500),
	CONSTRAINT "catalog_items_price_range" CHECK ("catalog_items"."price_cents" BETWEEN 0 AND 100000000)
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_updater_in_same_company_fk" FOREIGN KEY ("company_id","updated_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_items_company_position_idx" ON "catalog_items" USING btree ("company_id","position");