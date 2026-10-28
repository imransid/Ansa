ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
-- Added by hand: since this step, people who never confirmed their email take no
-- tickets (canTakeTickets, db/users.ts), but open tickets routed or assigned to
-- them before it would stay with someone who can't log in. Unassign them, so
-- they show as unassigned; routed_to_user_id (routing's first pick) stays.
UPDATE "tickets" SET "assigned_to_user_id" = NULL, "assigned_automatically" = NULL WHERE "status" = 'open' AND ("company_id", "assigned_to_user_id") IN (SELECT "company_id", "id" FROM "users" WHERE "email_verified" = false);
