ALTER TABLE "inbound_emails" ADD COLUMN "from_address" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "subject_encrypted" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "body_encrypted" text;