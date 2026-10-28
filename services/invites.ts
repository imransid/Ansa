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
import { getClientIpFromHeaders } from "@/lib/request-ip";
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

  if (await isOverRateLimit("invite-creations", session.companyId, RATE_LIMITS.inviteCreationsPerCompany)) {
    return {
      ok: false,
      errors: { message: "Too many new invites. Try again in an hour." },
    };
  }

  const { email, role } = parsed.data;
  // Removed people count too: their address stays taken (CLAUDE.md, Known gaps).
  if (await isEmailInCompany(session.companyId, email)) {
    return {
      ok: false,
      errors: { fieldErrors: { email: ["This address already belongs to someone on your team, or to someone removed from it."] } },
    };
  }

  const token = generateInviteToken();
  const created = await createInvite(session.companyId, {
    email,
    role,
    tokenHash: hashInviteToken(token),
    createdByUserId: session.userId,
    expiresAt: new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
  });
  // /db saves it only while they are still an active owner: someone removed or
  // made a member since this request began gets no link.
  if (!created) {
    return { ok: false, errors: onlyOwnersError };
  }

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

  if (await isOverRateLimit("invite-revocations", session.companyId, RATE_LIMITS.inviteRevocationsPerCompany)) {
    return {
      ok: false,
      errors: { message: "Too many revoked invites. Try again in an hour." },
    };
  }

  const wasRevoked = await revokeInvite(session.companyId, parsed.data.inviteId);
  if (!wasRevoked) {
    return { ok: false, errors: { message: "This invite is no longer pending." } };
  }
  return { ok: true };
}

// What the join page learns about an invite link. "rate-limited" is separate
// so a busy shared office IP isn't told that a good invite is dead.
export type InvitePreviewResult =
  | { status: "ready"; preview: InvitePreview }
  | { status: "not-usable" }
  | { status: "rate-limited" };

// Looks up who an invite link is for, so the join page can show it.
// "not-usable" covers unknown, used, revoked and expired links.
// requestHeaders: the incoming request's headers (the IP is the rate limit key).
export async function getInvitePreview(
  inviteToken: unknown,
  requestHeaders: Headers,
): Promise<InvitePreviewResult> {
  if (await isOverRateLimit("invite-preview", getClientIpFromHeaders(requestHeaders), RATE_LIMITS.invitePreviewPerIp)) {
    return { status: "rate-limited" };
  }

  const parsed = inviteTokenSchema.safeParse(inviteToken);
  if (!parsed.success) {
    return { status: "not-usable" };
  }

  const preview = await getInvitePreviewByTokenHash(hashInviteToken(parsed.data));
  return preview ? { status: "ready", preview } : { status: "not-usable" };
}

// Says whether this invite token can still be used, and by this email.
// Read-only: the invite is only claimed by the user-create hook (lib/auth.ts).
export async function isInviteUsableForEmail(inviteToken: string, email: string): Promise<boolean> {
  const preview = await getInvitePreviewByTokenHash(hashInviteToken(inviteToken));
  return preview !== undefined && preview.email === email;
}
