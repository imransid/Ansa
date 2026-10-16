// Checks that one company can never see another company's data, that callers
// cannot choose server-owned fields (company, role, ticket number), and that
// invite links only ever work as intended.
//
// Run with: pnpm check:tenant-isolation
// Needs the local database running and migrated (pnpm db:up && pnpm db:migrate).
// Creates throwaway companies, users, tickets, invites, emails, phone lines and
// calls, and deletes them at the end.

import { db } from "@/db/client";
import { runAssignmentChecks } from "./tenant-isolation/assignment-checks";
import { runBrainAnalysisChecks } from "./tenant-isolation/brain-analysis-checks";
import { runBrainGuardChecks } from "./tenant-isolation/brain-guard-checks";
import { runCallTicketChecks } from "./tenant-isolation/call-ticket-checks";
import { runCategoryChecks } from "./tenant-isolation/category-checks";
import { runEmailChecks } from "./tenant-isolation/email-checks";
import { cleanUpTestData, getFailureCount, signUpTestOwner } from "./tenant-isolation/helpers";
import { runInviteChecks } from "./tenant-isolation/invite-checks";
import { runPaginationChecks } from "./tenant-isolation/pagination-checks";
import { runRoutingChecks } from "./tenant-isolation/routing-checks";
import { runSignupChecks } from "./tenant-isolation/signup-checks";
import { runTicketChecks } from "./tenant-isolation/ticket-checks";
import { runTicketEmailChecks } from "./tenant-isolation/ticket-email-checks";
import { runVapiChecks } from "./tenant-isolation/vapi-checks";
import { runVerificationChecks } from "./tenant-isolation/verification-checks";

async function runChecksAndCleanUp() {
  try {
    const ownerA = await signUpTestOwner("a");
    const ownerB = await signUpTestOwner("b");
    await runSignupChecks(ownerA, ownerB);
    await runVerificationChecks();
    await runTicketChecks(ownerA, ownerB);
    await runInviteChecks(ownerA, ownerB);
    await runAssignmentChecks(ownerA, ownerB);
    await runEmailChecks(ownerA, ownerB);
    await runVapiChecks(ownerA, ownerB);
    await runBrainGuardChecks();
    await runBrainAnalysisChecks(ownerA, ownerB);
    await runCallTicketChecks(ownerA, ownerB);
    await runTicketEmailChecks(ownerA, ownerB);
    await runCategoryChecks(ownerA, ownerB);
    await runRoutingChecks(ownerA, ownerB);
    await runPaginationChecks(ownerB);
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
