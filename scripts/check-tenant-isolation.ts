// Checks that one company can never see another company's data, and that a
// signup request cannot choose its own company or role.
//
// Run with: pnpm check:tenant-isolation
// Needs the local database running and migrated (pnpm db:up && pnpm db:migrate).
// Creates throwaway companies and users, and deletes them again at the end.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { getCompanyById } from "@/db/companies";
import { companies, users } from "@/db/schema";
import { getUsersInCompany } from "@/db/users";
import { auth } from "@/lib/auth";

const runId = randomUUID().slice(0, 8);
const testPassword = "isolation-test-password";
const createdEmails: string[] = [];
let failures = 0;

function testEmail(label: string): string {
  const email = `isolation-${label}-${runId}@example.test`;
  createdEmails.push(email);
  return email;
}

type SignupBody = { name: string; email: string; password: string } & Record<
  string,
  unknown
>;

// Calls Better Auth's signup the way a real request would, including fields its
// types don't list (companyName, or a smuggled companyId / role).
function signUpWithBody(body: SignupBody) {
  return auth.api.signUpEmail({ body });
}

async function signUpTestOwner(label: string) {
  const result = await signUpWithBody({
    name: `Owner ${label}`,
    email: testEmail(label),
    password: testPassword,
    companyName: `Isolation test ${label} ${runId}`,
  });
  return result.user;
}

async function check(description: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${description}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${description}`);
    console.log(`      ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  const ownerA = await signUpTestOwner("a");
  const ownerB = await signUpTestOwner("b");

  await check("signup creates a company and makes the user its owner", async () => {
    assert.ok(ownerA.companyId, "owner A has no companyId");
    assert.equal(ownerA.role, "owner");
    const companyA = await getCompanyById(ownerA.companyId);
    assert.equal(companyA?.name, `Isolation test a ${runId}`);
  });

  await check("two signups get two different companies", async () => {
    assert.notEqual(ownerA.companyId, ownerB.companyId);
  });

  await check("company A's user list contains only company A's users", async () => {
    const usersInA = await getUsersInCompany(ownerA.companyId!);
    assert.deepEqual(usersInA.map((user) => user.id), [ownerA.id]);
  });

  await check("company B's user list contains only company B's users", async () => {
    const usersInB = await getUsersInCompany(ownerB.companyId!);
    assert.deepEqual(usersInB.map((user) => user.id), [ownerB.id]);
  });

  await check("signup cannot join another company by sending companyId", async () => {
    const attackerEmail = testEmail("attacker-company");
    await assert.rejects(
      signUpWithBody({
        name: "Attacker",
        email: attackerEmail,
        password: testPassword,
        companyName: `Attacker company ${runId}`,
        companyId: ownerA.companyId,
      }),
      /companyId is not allowed to be set/,
    );
    const usersInA = await getUsersInCompany(ownerA.companyId!);
    assert.ok(!usersInA.some((user) => user.email === attackerEmail));
  });

  await check("signup cannot pick its own role by sending role", async () => {
    await assert.rejects(
      signUpWithBody({
        name: "Attacker",
        email: testEmail("attacker-role"),
        password: testPassword,
        companyName: `Attacker company ${runId}`,
        role: "owner",
      }),
      /role is not allowed to be set/,
    );
  });

  await check("signup without a company name creates nothing", async () => {
    await assert.rejects(
      signUpWithBody({
        name: "No company",
        email: testEmail("no-company"),
        password: testPassword,
      }),
    );
  });
}

// Test data is removed directly here (not through /db) because the app itself
// never deletes users or companies yet.
async function cleanUp() {
  await db.delete(users).where(inArray(users.email, createdEmails));
  await db.delete(companies).where(like(companies.name, `%${runId}`));
}

async function runChecksAndCleanUp() {
  try {
    await main();
  } finally {
    await cleanUp();
    await db.$client.end();
  }

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
