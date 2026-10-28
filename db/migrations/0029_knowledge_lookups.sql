CREATE TABLE "knowledge_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vapi_call_id" text NOT NULL,
	"article_ids" uuid[] NOT NULL,
	"hit_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_lookups_hit_count_range" CHECK ("knowledge_lookups"."hit_count" BETWEEN 0 AND 3),
	CONSTRAINT "knowledge_lookups_articles_within_hits" CHECK (cardinality("knowledge_lookups"."article_ids") <= "knowledge_lookups"."hit_count"),
	CONSTRAINT "knowledge_lookups_vapi_call_id_length" CHECK (char_length("knowledge_lookups"."vapi_call_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "knowledge_lookups" ADD CONSTRAINT "knowledge_lookups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_lookups_company_id_vapi_call_id_created_at_idx" ON "knowledge_lookups" USING btree ("company_id","vapi_call_id","created_at");