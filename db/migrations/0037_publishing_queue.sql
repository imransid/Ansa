CREATE TABLE "autopublish_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"pillar" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"enabled_by_user_id" text,
	"enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopublish_rules_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "autopublish_rules_platform_known" CHECK ("autopublish_rules"."platform" IN ('linkedin', 'facebook', 'x', 'youtube')),
	CONSTRAINT "autopublish_rules_pillar_length" CHECK (char_length("autopublish_rules"."pillar") <= 200),
	CONSTRAINT "autopublish_rules_enabled_fields" CHECK ("autopublish_rules"."enabled" = ("autopublish_rules"."enabled_by_user_id" IS NOT NULL) AND "autopublish_rules"."enabled" = ("autopublish_rules"."enabled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "publish_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"approval_mode" text NOT NULL,
	"approved_version" integer NOT NULL,
	"autopublish_rule_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"external_post_id" text,
	"external_url" text,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"canceled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_jobs_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "publish_jobs_status_known" CHECK ("publish_jobs"."status" IN ('queued', 'publishing', 'published', 'failed', 'canceled', 'needs_attention')),
	CONSTRAINT "publish_jobs_approval_mode_known" CHECK ("publish_jobs"."approval_mode" IN ('owner', 'auto_rule')),
	CONSTRAINT "publish_jobs_rule_with_auto_mode" CHECK (("publish_jobs"."approval_mode" = 'auto_rule') = ("publish_jobs"."autopublish_rule_id" IS NOT NULL)),
	CONSTRAINT "publish_jobs_approved_version_positive" CHECK ("publish_jobs"."approved_version" >= 1),
	CONSTRAINT "publish_jobs_attempts_range" CHECK ("publish_jobs"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "publish_jobs_last_error_is_code" CHECK ("publish_jobs"."last_error" ~ '^[a-z0-9_]{1,60}$'),
	CONSTRAINT "publish_jobs_problem_has_error" CHECK ("publish_jobs"."status" NOT IN ('failed', 'needs_attention') OR "publish_jobs"."last_error" IS NOT NULL),
	CONSTRAINT "publish_jobs_publishing_claimed" CHECK ("publish_jobs"."status" <> 'publishing' OR ("publish_jobs"."claimed_at" IS NOT NULL AND "publish_jobs"."attempts" >= 1)),
	CONSTRAINT "publish_jobs_published_has_time" CHECK (("publish_jobs"."status" = 'published') = ("publish_jobs"."published_at" IS NOT NULL)),
	CONSTRAINT "publish_jobs_post_only_when_published" CHECK (("publish_jobs"."external_post_id" IS NULL AND "publish_jobs"."external_url" IS NULL) OR "publish_jobs"."status" = 'published'),
	CONSTRAINT "publish_jobs_external_post_id_format" CHECK ("publish_jobs"."external_post_id" ~ '^[A-Za-z0-9_:.-]{1,200}$'),
	CONSTRAINT "publish_jobs_external_url_https" CHECK ("publish_jobs"."external_url" ~ '^https://' AND char_length("publish_jobs"."external_url") <= 2000),
	CONSTRAINT "publish_jobs_canceler_only_when_canceled" CHECK ("publish_jobs"."canceled_by_user_id" IS NULL OR "publish_jobs"."status" = 'canceled')
);
--> statement-breakpoint
CREATE TABLE "cofounder_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"draft_id" uuid,
	"job_id" uuid,
	"connection_id" uuid,
	"rule_id" uuid,
	"plan_version" integer,
	"code" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "cofounder_activity_action_known" CHECK ("cofounder_activity"."action" IN ('connected', 'disconnected', 'reconnect_needed', 'draft_approved', 'draft_rejected', 'draft_changed_after_approval', 'draft_archived', 'draft_restored', 'idea_planned', 'scheduled', 'canceled', 'publish_now', 'published', 'publish_failed', 'publish_delayed', 'needs_attention', 'marked_published', 'marked_not_published', 'retried', 'rule_created', 'rule_enabled', 'rule_disabled', 'plan_created')),
	CONSTRAINT "cofounder_activity_code_format" CHECK ("cofounder_activity"."code" ~ '^[a-z0-9_]{1,60}$')
);
--> statement-breakpoint
ALTER TABLE "autopublish_rules" ADD CONSTRAINT "autopublish_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopublish_rules" ADD CONSTRAINT "autopublish_rules_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopublish_rules" ADD CONSTRAINT "autopublish_rules_enabler_in_same_company_fk" FOREIGN KEY ("company_id","enabled_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_draft_in_same_company_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."content_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_connection_in_same_company_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."social_connections"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_rule_in_same_company_fk" FOREIGN KEY ("company_id","autopublish_rule_id") REFERENCES "public"."autopublish_rules"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_creator_in_same_company_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_canceler_in_same_company_fk" FOREIGN KEY ("company_id","canceled_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_activity" ADD CONSTRAINT "cofounder_activity_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_activity" ADD CONSTRAINT "cofounder_activity_actor_in_same_company_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_activity" ADD CONSTRAINT "cofounder_activity_draft_in_same_company_fk" FOREIGN KEY ("company_id","draft_id") REFERENCES "public"."content_drafts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_activity" ADD CONSTRAINT "cofounder_activity_job_in_same_company_fk" FOREIGN KEY ("company_id","job_id") REFERENCES "public"."publish_jobs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_activity" ADD CONSTRAINT "cofounder_activity_connection_in_same_company_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."social_connections"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_activity" ADD CONSTRAINT "cofounder_activity_rule_in_same_company_fk" FOREIGN KEY ("company_id","rule_id") REFERENCES "public"."autopublish_rules"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cofounder_activity" ADD CONSTRAINT "cofounder_activity_plan_in_same_company_fk" FOREIGN KEY ("company_id","plan_version") REFERENCES "public"."marketing_plans"("company_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autopublish_rules_one_per_platform_pillar" ON "autopublish_rules" USING btree ("company_id","platform",lower("pillar"));--> statement-breakpoint
CREATE UNIQUE INDEX "publish_jobs_one_live_per_draft_account" ON "publish_jobs" USING btree ("company_id","draft_id","connection_id") WHERE "publish_jobs"."status" IN ('queued', 'publishing', 'published', 'needs_attention');--> statement-breakpoint
CREATE INDEX "publish_jobs_due_idx" ON "publish_jobs" USING btree ("run_after") WHERE "publish_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "publish_jobs_publishing_idx" ON "publish_jobs" USING btree ("claimed_at") WHERE "publish_jobs"."status" = 'publishing';--> statement-breakpoint
CREATE INDEX "publish_jobs_company_id_status_scheduled_for_idx" ON "publish_jobs" USING btree ("company_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "publish_jobs_company_id_scheduled_for_idx" ON "publish_jobs" USING btree ("company_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "publish_jobs_company_id_draft_id_idx" ON "publish_jobs" USING btree ("company_id","draft_id");--> statement-breakpoint
CREATE INDEX "cofounder_activity_company_id_created_at_idx" ON "cofounder_activity" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "cofounder_activity_company_id_draft_id_created_at_idx" ON "cofounder_activity" USING btree ("company_id","draft_id","created_at");