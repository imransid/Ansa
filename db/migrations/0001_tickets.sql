CREATE TYPE "public"."ticket_channel" AS ENUM('phone', 'email');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'solved');--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_number" integer NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"channel" "ticket_channel" NOT NULL,
	"category" text,
	"customer_name" text,
	"customer_email" text,
	"customer_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_company_id_ticket_number_unique" UNIQUE("company_id","ticket_number")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_ticket_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;