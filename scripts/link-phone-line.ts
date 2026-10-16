// Links a Vapi phone number id to the company of an existing user, so calls to
// that number are saved for that company. Stand-in for the onboarding flow (step 12).
//
// Run with: pnpm link:phone-line you@example.com <vapiPhoneNumberId>
// For local testing any id works, e.g. "pn-local-test".

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { findPhoneLineByVapiNumberId, createPhoneLine } from "@/db/phone-lines";
import { users } from "@/db/schema";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const vapiPhoneNumberId = process.argv[3]?.trim();
  if (!email || !vapiPhoneNumberId) {
    console.error("Usage: pnpm link:phone-line you@example.com <vapiPhoneNumberId>");
    process.exitCode = 1;
    return;
  }

  // Looked up directly here, not through /db, on purpose: "find a company by
  // email" is only safe in a local dev script (same as seed-tickets.ts).
  const [user] = await db
    .select({ companyId: users.companyId })
    .from(users)
    .where(eq(users.email, email));
  if (!user) {
    console.error(`No user with email ${email}. Sign up in the app first.`);
    process.exitCode = 1;
    return;
  }

  const existing = await findPhoneLineByVapiNumberId(vapiPhoneNumberId);
  if (existing) {
    const sameCompany = existing.companyId === user.companyId;
    console.log(sameCompany ? "Already linked to this company." : "This number already belongs to another company.");
    process.exitCode = sameCompany ? 0 : 1;
    return;
  }

  await createPhoneLine(user.companyId, vapiPhoneNumberId);
  console.log(`Linked ${vapiPhoneNumberId} to ${email}'s company.`);
}

main()
  .catch((error) => {
    console.error("Linking failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
