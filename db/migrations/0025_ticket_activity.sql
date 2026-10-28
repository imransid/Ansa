CREATE TYPE "public"."ticket_activity_kind" AS ENUM('note', 'assigned', 'unassigned', 'routed', 'solved', 'closed_without_email', 'reopened', 'category_set', 'customer_email_set');--> statement-breakpoint
CREATE TABLE "ticket_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" "ticket_activity_kind" NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"category" text,
	"body_encrypted" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ticket_activity_body_only_on_notes" CHECK (("ticket_activity"."kind" = 'note') = ("ticket_activity"."body_encrypted" IS NOT NULL)),
	CONSTRAINT "ticket_activity_note_has_author" CHECK ("ticket_activity"."kind" <> 'note' OR "ticket_activity"."actor_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticket_in_same_company_fk" FOREIGN KEY ("company_id","ticket_id") REFERENCES "public"."tickets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_actor_in_same_company_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_target_in_same_company_fk" FOREIGN KEY ("company_id","target_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_activity_company_id_ticket_id_created_at_idx" ON "ticket_activity" USING btree ("company_id","ticket_id","created_at");