CREATE TABLE "performance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"input_summary" jsonb NOT NULL,
	"review" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_reviews_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "performance_reviews_period_order" CHECK ("performance_reviews"."period_end" > "performance_reviews"."period_start"),
	CONSTRAINT "performance_reviews_input_is_object" CHECK (jsonb_typeof("performance_reviews"."input_summary") = 'object'),
	CONSTRAINT "performance_reviews_review_is_object" CHECK (jsonb_typeof("performance_reviews"."review") = 'object'),
	CONSTRAINT "performance_reviews_input_size" CHECK (char_length("performance_reviews"."input_summary"::text) <= 200000),
	CONSTRAINT "performance_reviews_review_size" CHECK (char_length("performance_reviews"."review"::text) <= 100000)
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"publish_job_id" uuid NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"views" integer,
	"reach" integer,
	"reactions" integer,
	"comments" integer,
	"shares" integer,
	"clicks" integer,
	"video_views" integer,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_metrics_source_known" CHECK ("post_metrics"."source" IN ('platform', 'dev_simulated')),
	CONSTRAINT "post_metrics_counts_not_negative" CHECK ("post_metrics"."views" >= 0 AND "post_metrics"."reach" >= 0 AND "post_metrics"."reactions" >= 0 AND "post_metrics"."comments" >= 0 AND "post_metrics"."shares" >= 0 AND "post_metrics"."clicks" >= 0 AND "post_metrics"."video_views" >= 0),
	CONSTRAINT "post_metrics_has_a_number" CHECK (num_nonnulls("post_metrics"."views", "post_metrics"."reach", "post_metrics"."reactions", "post_metrics"."comments", "post_metrics"."shares", "post_metrics"."clicks", "post_metrics"."video_views") >= 1)
);
--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD COLUMN "performance_review_id" uuid;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD COLUMN "metrics_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD COLUMN "metrics_error" text;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_job_in_same_company_fk" FOREIGN KEY ("company_id","publish_job_id") REFERENCES "public"."publish_jobs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_reviews_company_id_created_at_idx" ON "performance_reviews" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "post_metrics_company_id_job_id_collected_at_idx" ON "post_metrics" USING btree ("company_id","publish_job_id","collected_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_review_in_same_company_fk" FOREIGN KEY ("company_id","performance_review_id") REFERENCES "public"."performance_reviews"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publish_jobs_published_at_idx" ON "publish_jobs" USING btree ("published_at") WHERE "publish_jobs"."status" = 'published';--> statement-breakpoint
CREATE INDEX "publish_jobs_company_id_published_at_idx" ON "publish_jobs" USING btree ("company_id","published_at") WHERE "publish_jobs"."status" = 'published';--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_metrics_only_when_published" CHECK ("publish_jobs"."metrics_attempted_at" IS NULL OR "publish_jobs"."status" = 'published');--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_metrics_error_is_code" CHECK ("publish_jobs"."metrics_error" ~ '^[a-z0-9_]{1,60}$');--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_metrics_error_with_attempt" CHECK ("publish_jobs"."metrics_error" IS NULL OR "publish_jobs"."metrics_attempted_at" IS NOT NULL);