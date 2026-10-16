ALTER TABLE "calls" ADD CONSTRAINT "calls_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "call_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_call_in_same_company_fk" FOREIGN KEY ("company_id","call_id") REFERENCES "public"."calls"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_call_id_unique" UNIQUE("call_id");
