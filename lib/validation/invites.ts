import { z } from "zod";
import { userRoles } from "@/db/schema";
import { emailSchema, newPasswordSchema, personNameSchema } from "./auth";

// Tokens are 32 random bytes in base64url, which is always 43 characters.
// Checking the exact shape rejects junk before it reaches the database.
export const inviteTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "This invite link is not valid");

export const createInviteSchema = z.object({
  email: emailSchema,
  role: z.enum(userRoles, "Choose a role"),
});

export const revokeInviteSchema = z.object({
  inviteId: z.uuid(),
});

export const joinWithInviteSchema = z.object({
  inviteToken: inviteTokenSchema,
  name: personNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
});

// Used by the user-create hook in lib/auth.ts when a signup carries an invite.
export const inviteSignupBodySchema = z.object({
  inviteToken: inviteTokenSchema,
});
