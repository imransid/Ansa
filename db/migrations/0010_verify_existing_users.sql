-- Step 12 turns on required email verification. Accounts created before this
-- step were never asked to confirm their address; mark them confirmed so they
-- can still log in. Every new account must confirm by email.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
