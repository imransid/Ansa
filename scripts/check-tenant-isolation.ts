// Checks that one company can never see another company's data, and that
// callers cannot choose server-owned fields (company, role, ticket number).
//
// Run with: pnpm check:tenant-isolation
// Needs the local database running and migrated (pnpm db:up && pnpm db:migrate).
// Creates throwaway companies, users and tickets, and deletes them again at the end.

import { db } from "@/db/client";
import { cleanUpTestData, getFailureCount, signUpTestOwner } from "./tenant-isolation/helpers";
import { runSignupChecks } from "./tenant-isolation/signup-checks";
import { runTicketChecks } from "./tenant-isolation/ticket-checks";

async function runChecksAndCleanUp() {
  try {
    const ownerA = await signUpTestOwner("a");
    const ownerB = await signUpTestOwner("b");
    await runSignupChecks(ownerA, ownerB);
    await runTicketChecks(ownerA, ownerB);
  } finally {
    await cleanUpTestData();
    await db.$client.end();
  }

  const failures = getFailureCount();
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll tenant isolation checks passed.");
}

runChecksAndCleanUp().catch((error) => {
  console.error("Could not run the checks:", error);
  process.exit(1);
});
