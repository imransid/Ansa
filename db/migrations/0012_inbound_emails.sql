CREATE TYPE "public"."inbound_email_status" AS ENUM('received', 'processing', 'ticketed', 'ignored');--> statement-breakpoint
CREATE TABLE "inbound_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_addresses_address_unique" UNIQUE("address"),
	CONSTRAINT "inbound_addresses_company_id_id_unique" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"resend_email_id" text NOT NULL,
	"status" "inbound_email_status" DEFAULT 'received' NOT NULL,
	"ignored_reason" text,
	"ticket_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_emails_resend_email_id_unique" UNIQUE("resend_email_id"),
	CONSTRAINT "inbound_emails_ticket_matches_status" CHECK (("inbound_emails"."status" = 'ticketed') = ("inbound_emails"."ticket_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD CONSTRAINT "inbound_addresses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_ticket_in_same_company_fk" FOREIGN KEY ("company_id","ticket_id") REFERENCES "public"."tickets"("company_id","id") ON DELETE no action ON UPDATE no action;