CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"phone_line_id" uuid NOT NULL,
	"vapi_call_id" text NOT NULL,
	"caller_number" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"transcript_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_vapi_call_id_unique" UNIQUE("vapi_call_id")
);
--> statement-breakpoint
CREATE TABLE "phone_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vapi_phone_number_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_lines_vapi_phone_number_id_unique" UNIQUE("vapi_phone_number_id"),
	CONSTRAINT "phone_lines_company_id_id_unique" UNIQUE("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_phone_line_in_same_company_fk" FOREIGN KEY ("company_id","phone_line_id") REFERENCES "public"."phone_lines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_lines" ADD CONSTRAINT "phone_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_company_id_created_at_idx" ON "calls" USING btree ("company_id","created_at");