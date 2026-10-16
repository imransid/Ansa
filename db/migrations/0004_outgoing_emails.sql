ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
CREATE TYPE "public"."email_kind" AS ENUM('ticket_solved');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "outgoing_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" "email_kind" NOT NULL,
	"to_email" text NOT NULL,
	"status" "email_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "reply_to_email" text;--> statement-breakpoint
ALTER TABLE "outgoing_emails" ADD CONSTRAINT "outgoing_emails_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_emails" ADD CONSTRAINT "outgoing_emails_ticket_in_same_company_fk" FOREIGN KEY ("company_id","ticket_id") REFERENCES "public"."tickets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outgoing_emails_company_id_ticket_id_idx" ON "outgoing_emails" USING btree ("company_id","ticket_id");--> statement-breakpoint
