ALTER TABLE "users" ADD CONSTRAINT "users_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "assigned_to_user_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "solved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "solved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_in_same_company_fk" FOREIGN KEY ("company_id","assigned_to_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_solver_in_same_company_fk" FOREIGN KEY ("company_id","solved_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_solved_fields_match_status" CHECK (("tickets"."status" = 'solved') = ("tickets"."solved_at" IS NOT NULL AND "tickets"."solved_by_user_id" IS NOT NULL));