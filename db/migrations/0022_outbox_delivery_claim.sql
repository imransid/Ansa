ALTER TYPE "public"."email_status" ADD VALUE 'sending' BEFORE 'sent';--> statement-breakpoint
ALTER TABLE "outgoing_emails" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outgoing_emails" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
-- Added by hand: emails from before this step have no attempt times. Their
-- first try ran right after the row was written (the solve's own delivery), so
-- created_at stands in for it: Retry then asks before sending one again whose
-- first try is more than 23 hours old (Resend forgets the idempotency key after
-- 24). Before this step attempt_count only went up once an outcome was saved,
-- so a "pending" row without an error may have reached Resend too (the server
-- stopped before saving "sent"): it counts as tried. Only rows the daily limit
-- held back (last_error 'daily_limit', never handed to Resend) keep it empty.
-- updated_at stands in for the latest try of rows with a saved outcome. The new
-- 'sending' value is not used here: drizzle-kit runs every pending migration in
-- one transaction, and Postgres refuses a new enum value until that commits.
UPDATE "outgoing_emails" SET "first_attempt_at" = "created_at" WHERE "attempt_count" > 0 OR ("status" = 'pending' AND "last_error" IS NULL);--> statement-breakpoint
UPDATE "outgoing_emails" SET "last_attempt_at" = "updated_at" WHERE "attempt_count" > 0;
