import "server-only";
import { APIError } from "better-auth/api";
import { createCompany } from "@/db/companies";
import { claimInvite } from "@/db/invites";
import type { UserRole } from "@/db/schema";
import { hashInviteToken } from "@/lib/invite-token";
import { newCompanySchema } from "@/lib/validation/auth";
import { inviteSignupBodySchema } from "@/lib/validation/invites";

type Membership = {
  companyId: string;
  role: UserRole;
};

// Error codes the signup services turn into friendly messages.
export const MEMBERSHIP_ERROR_CODES = {
  invalidCompanyName: "INVALID_COMPANY_NAME",
  inviteNotUsable: "INVITE_NOT_USABLE",
} as const;

// Decides which company a brand-new user joins and with what role.
// Called only by the user-create hook in lib/auth.ts, before the user row is saved.
// - Signup with an invite token: join the inviting company with the invited role.
// - Signup without one: create a new company and become its owner.
export async function createMembershipForNewUser(
  signupRequestBody: unknown,
  newUserEmail: string,
): Promise<Membership> {
  if (hasInviteToken(signupRequestBody)) {
    return joinCompanyWithInviteToken(signupRequestBody, newUserEmail);
  }
  return createCompanyForNewOwner(signupRequestBody);
}

function hasInviteToken(body: unknown): boolean {
  return typeof body === "object" && body !== null && "inviteToken" in body;
}

async function joinCompanyWithInviteToken(
  signupRequestBody: unknown,
  newUserEmail: string,
): Promise<Membership> {
  // Fail closed: a bad invite never falls back to creating a new company.
  const parsed = inviteSignupBodySchema.safeParse(signupRequestBody);
  if (!parsed.success) {
    throw inviteNotUsableError();
  }

  // Known gap: the invite is marked used before Better Auth saves the user.
  // If saving the user then fails, the invite is spent and the owner must make
  // a new one. (An already-registered email is rejected before this runs.)
  const claimed = await claimInvite(
    hashInviteToken(parsed.data.inviteToken),
    newUserEmail,
  );
  if (!claimed) {
    throw inviteNotUsableError();
  }
  return { companyId: claimed.companyId, role: claimed.role };
}

async function createCompanyForNewOwner(
  signupRequestBody: unknown,
): Promise<Membership> {
  // Fail closed: a user is never created without a company.
  const parsed = newCompanySchema.safeParse(signupRequestBody);
  if (!parsed.success) {
    throw APIError.from("BAD_REQUEST", {
      code: MEMBERSHIP_ERROR_CODES.invalidCompanyName,
      message: "Cannot create a user without a valid company name",
    });
  }

  // Known gap: this insert is not in the same transaction as the user insert.
  // If the user insert fails afterwards, an empty company row is left behind.
  // Nobody can log into it, so it is harmless, just untidy.
  const company = await createCompany(parsed.data.companyName);
  return { companyId: company.id, role: "owner" };
}

// Thrown as a Better Auth APIError so Better Auth passes it back to our
// service unchanged (it would log and replace a plain Error).
function inviteNotUsableError(): APIError {
  return APIError.from("BAD_REQUEST", {
    code: MEMBERSHIP_ERROR_CODES.inviteNotUsable,
    message: "This invite is not valid, already used, revoked or expired",
  });
}
