CREATE TABLE "core_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_error_code" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "core_jobs_status_known" CHECK ("core_jobs"."status" IN ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "core_jobs_kind_format" CHECK ("core_jobs"."kind" ~ '^[a-z][a-z0-9_.]{1,60}$'),
	CONSTRAINT "core_jobs_attempts_range" CHECK ("core_jobs"."attempts" >= 0 AND "core_jobs"."attempts" <= "core_jobs"."max_attempts" AND "core_jobs"."max_attempts" BETWEEN 1 AND 20),
	CONSTRAINT "core_jobs_error_code_format" CHECK ("core_jobs"."last_error_code" IS NULL OR "core_jobs"."last_error_code" ~ '^[a-z0-9_]{1,60}$')
);
--> statement-breakpoint
ALTER TABLE "core_jobs" ADD CONSTRAINT "core_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_jobs_due_idx" ON "core_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "core_jobs_one_waiting_per_key" ON "core_jobs" USING btree ("company_id","dedupe_key") WHERE "core_jobs"."dedupe_key" IS NOT NULL AND "core_jobs"."status" IN ('queued', 'running');