// Links an inbound email address (e.g. support@yourcompany.com, forwarded to
// Resend) to the company of an existing user, so emails to it become tickets.
// Stand-in for the onboarding flow (step 16).
//
// Run with: pnpm link:inbound-address you@example.com support@yourcompany.com

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createInboundAddress, findCompanyForInboundAddress } from "@/db/inbound-emails";
import { users } from "@/db/schema";
import { emailSchema } from "@/lib/validation/auth";

async function main() {
  const ownerEmail = process.argv[2]?.trim().toLowerCase();
  const address = emailSchema.safeParse(process.argv[3]);
  if (!ownerEmail || !address.success) {
    console.error("Usage: pnpm link:inbound-address you@example.com support@yourcompany.com");
    process.exitCode = 1;
    return;
  }
  // Looked up directly here, not through /db, on purpose (dev script only).
  const [user] = await db.select({ companyId: users.companyId }).from(users).where(eq(users.email, ownerEmail));
  if (!user) {
    console.error(`No user with email ${ownerEmail}. Sign up in the app first.`);
    process.exitCode = 1;
    return;
  }
  const existing = await findCompanyForInboundAddress(address.data);
  if (existing) {
    console.log(existing === user.companyId ? "Already linked to this company." : "That address belongs to another company.");
    process.exitCode = existing === user.companyId ? 0 : 1;
    return;
  }
  await createInboundAddress(user.companyId, address.data);
  console.log(`Linked ${address.data} to ${ownerEmail}'s company.`);
}

main()
  .catch((error) => {
    console.error("Linking failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
