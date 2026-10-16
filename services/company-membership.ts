import "server-only";
import { createCompany } from "@/db/companies";
import type { UserRole } from "@/db/schema";
import { newCompanySchema } from "@/lib/validation/auth";

type Membership = {
  companyId: string;
  role: UserRole;
};

// Decides which company a brand-new user joins and with what role.
// Today every signup creates a new company and the user becomes its owner.
// Step 3 (invites) will add a second path: join an existing company via an invite link.
export async function createMembershipForNewUser(
  signupRequestBody: unknown,
): Promise<Membership> {
  const parsed = newCompanySchema.safeParse(signupRequestBody);
  if (!parsed.success) {
    // Fail closed: a user is never created without a company.
    throw new Error("Cannot create a user without a valid company name");
  }

  // Known gap: this insert is not in the same transaction as the user insert.
  // If the user insert fails afterwards, an empty company row is left behind.
  // Nobody can log into it, so it is harmless, just untidy.
  const company = await createCompany(parsed.data.companyName);
  return { companyId: company.id, role: "owner" };
}
