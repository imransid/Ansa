-- Moved by hand to the top: knowledge_articles_document_in_same_company_fk
-- below needs this unique pair, and drizzle-kit wrote it last.
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"use_for_support" boolean DEFAULT true NOT NULL,
	"use_for_marketing" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_document_id" uuid,
	"source_ticket_id" uuid,
	"source_url" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_articles_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "knowledge_articles_kind_known" CHECK ("knowledge_articles"."kind" IN ('faq', 'policy', 'product', 'guide', 'solution', 'document', 'website')),
	CONSTRAINT "knowledge_articles_status_known" CHECK ("knowledge_articles"."status" IN ('draft', 'approved', 'archived')),
	CONSTRAINT "knowledge_articles_title_length" CHECK (char_length("knowledge_articles"."title") BETWEEN 1 AND 200),
	CONSTRAINT "knowledge_articles_body_length" CHECK (char_length("knowledge_articles"."body") BETWEEN 1 AND 20000),
	CONSTRAINT "knowledge_articles_source_url_https" CHECK ("knowledge_articles"."source_url" IS NULL OR ("knowledge_articles"."source_url" LIKE 'https://%' AND char_length("knowledge_articles"."source_url") <= 2000)),
	CONSTRAINT "knowledge_articles_one_source_at_most" CHECK (num_nonnulls("knowledge_articles"."source_document_id", "knowledge_articles"."source_ticket_id", "knowledge_articles"."source_url") <= 1),
	CONSTRAINT "knowledge_articles_approval_fields_together" CHECK (("knowledge_articles"."approved_by_user_id" IS NULL) = ("knowledge_articles"."approved_at" IS NULL)),
	CONSTRAINT "knowledge_articles_approved_has_approver" CHECK ("knowledge_articles"."status" <> 'approved' OR "knowledge_articles"."approved_by_user_id" IS NOT NULL),
	CONSTRAINT "knowledge_articles_draft_has_no_approver" CHECK ("knowledge_articles"."status" <> 'draft' OR "knowledge_articles"."approved_by_user_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"heading" text NOT NULL,
	"text" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', lower(normalize("heading", NFKC) COLLATE "und-x-icu")), 'A') || setweight(to_tsvector('simple', lower(normalize("text", NFKC) COLLATE "und-x-icu")), 'B')) STORED NOT NULL,
	CONSTRAINT "knowledge_chunks_article_id_position_unique" UNIQUE("article_id","position"),
	CONSTRAINT "knowledge_chunks_text_length" CHECK (char_length("knowledge_chunks"."text") BETWEEN 1 AND 1600),
	CONSTRAINT "knowledge_chunks_position_not_negative" CHECK ("knowledge_chunks"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_document_in_same_company_fk" FOREIGN KEY ("company_id","source_document_id") REFERENCES "public"."company_documents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_ticket_in_same_company_fk" FOREIGN KEY ("company_id","source_ticket_id") REFERENCES "public"."tickets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_updater_in_same_company_fk" FOREIGN KEY ("company_id","updated_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_approver_in_same_company_fk" FOREIGN KEY ("company_id","approved_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_article_in_same_company_fk" FOREIGN KEY ("company_id","article_id") REFERENCES "public"."knowledge_articles"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_articles_company_id_status_updated_at_idx" ON "knowledge_articles" USING btree ("company_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "knowledge_articles_company_id_updated_at_idx" ON "knowledge_articles" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "knowledge_articles_company_id_source_document_idx" ON "knowledge_articles" USING btree ("company_id","source_document_id") WHERE "knowledge_articles"."source_document_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_vector_idx" ON "knowledge_chunks" USING gin ("search_vector");