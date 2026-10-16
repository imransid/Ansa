import "server-only";
import { z } from "zod";
import {
  createInvite,
  getInvitePreviewByTokenHash,
  revokeInvite,
  type InvitePreview,
} from "@/db/invites";
import { isEmailInCompany } from "@/db/users";
import { env } from "@/lib/env";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { generateInviteToken, hashInviteToken } from "@/lib/invite-token";
import { getClientIp } from "@/lib/request-ip";
import type { SessionContext } from "@/lib/session";
import {
  createInviteSchema,
  inviteTokenSchema,
  revokeInviteSchema,
} from "@/lib/validation/invites";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Re-exported so pages can use the type without importing from /db.
export type { InvitePreview };

const INVITE_LIFETIME_DAYS = 7;

export type CreateInviteResult =
  | { ok: true; inviteLink: string }
  | { ok: false; errors: FormErrors };

const onlyOwnersError: FormErrors = {
  message: "Only owners can manage invites.",
};

// Creates a 7-day, single-use invite link for one email to join the session's company.
export async function createInviteForSession(
  session: SessionContext,
  input: unknown,
): Promise<CreateInviteResult> {
  if (session.role !== "owner") {
    return { ok: false, errors: onlyOwnersError };
  }

  const parsed = createInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors },
    };
  }

  if (await isOverRateLimit("invite-changes", session.companyId, RATE_LIMITS.inviteChangesPerCompany)) {
    return {
      ok: false,
      errors: { message: "Too many invite changes. Try again in an hour." },
    };
  }

  const { email, role } = parsed.data;
  if (await isEmailInCompany(session.companyId, email)) {
    return {
      ok: false,
      errors: { fieldErrors: { email: ["This person is already on your team."] } },
    };
  }

  const token = generateInviteToken();
  await createInvite(session.companyId, {
    email,
    role,
    tokenHash: hashInviteToken(token),
    createdByUserId: session.userId,
    expiresAt: new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
  });

  // The token goes after "#", which browsers never send to the server.
  // That keeps it out of request logs. The join page reads it in the browser.
  return { ok: true, inviteLink: `${env.BETTER_AUTH_URL}/invite#${token}` };
}

// Revokes one of the session company's pending invites so its link stops working.
export async function revokeInviteForSession(
  session: SessionContext,
  input: unknown,
): Promise<FormResult> {
  if (session.role !== "owner") {
    return { ok: false, errors: onlyOwnersError };
  }

  const parsed = revokeInviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown invite." } };
  }

  if (await isOverRateLimit("invite-changes", session.companyId, RATE_LIMITS.inviteChangesPerCompany)) {
    return {
      ok: false,
      errors: { message: "Too many invite changes. Try again in an hour." },
    };
  }

  const wasRevoked = await revokeInvite(session.companyId, parsed.data.inviteId);
  if (!wasRevoked) {
    return { ok: false, errors: { message: "This invite is no longer pending." } };
  }
  return { ok: true };
}

// Looks up who an invite link is for, so the join page can show it.
// Returns null for unknown, used, revoked or expired links.
export async function getInvitePreview(
  inviteToken: unknown,
): Promise<InvitePreview | null> {
  if (await isOverRateLimit("invite-preview", await getClientIp(), RATE_LIMITS.invitePreviewPerIp)) {
    return null;
  }

  const parsed = inviteTokenSchema.safeParse(inviteToken);
  if (!parsed.success) {
    return null;
  }

  const preview = await getInvitePreviewByTokenHash(hashInviteToken(parsed.data));
  return preview ?? null;
}
