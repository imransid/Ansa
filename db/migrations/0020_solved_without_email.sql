ALTER TABLE "tickets" ADD COLUMN "solved_without_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "sender_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_solved_without_email_only_when_solved" CHECK (NOT "tickets"."solved_without_email" OR "tickets"."status" = 'solved');