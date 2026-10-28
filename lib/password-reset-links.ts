import "server-only";
import { z } from "zod";
import { auth } from "@/lib/auth";

// What the reset service needs to know about the account a reset link belongs
// to. companyId is our own field (additionalFields in lib/auth.ts), so it is
// checked rather than assumed.
const resetLinkAccountSchema = z.object({
  id: z.string().min(1),
  companyId: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  // Set when an owner removed this person from the team.
  deactivatedAt: z.date().nullable(),
});

export type ResetLinkAccount = z.infer<typeof resetLinkAccountSchema>;

// Finds the account a password reset link belongs to WITHOUT using the link
// up, so the reset service can decide what the link may do before Better Auth
// sets a password. Returns null for an unknown or expired link. Better Auth
// stores a link as "reset-password:<token>" (hashed: verification in
// lib/auth.ts) with the user's id as its value (api/routes/password.mjs), and
// this lookup hashes the token the same way.
export async function findAccountForResetLink(token: string): Promise<ResetLinkAccount | null> {
  const context = await auth.$context;
  const link = await context.internalAdapter.findVerificationValue(`reset-password:${token}`);
  if (!link || link.expiresAt < new Date()) {
    return null;
  }
  const user = await context.internalAdapter.findUserById(link.value);
  const parsed = resetLinkAccountSchema.safeParse(user);
  return parsed.success ? parsed.data : null;
}
