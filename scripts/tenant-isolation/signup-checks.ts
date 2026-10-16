// Signup and user checks: each signup gets its own company, users stay inside
// their company, and a request cannot pick its own company or role.

import assert from "node:assert/strict";
import { getCompanyById } from "@/db/companies";
import { getUsersInCompany } from "@/db/users";
import {
  check,
  runId,
  signUpTestOwner,
  signUpWithBody,
  testEmail,
  testPassword,
  type TestUser,
} from "./helpers";

export async function runSignupChecks(ownerA: TestUser, ownerB: TestUser) {
  await check("signup creates a company and makes the user its owner", async () => {
    assert.equal(ownerA.role, "owner");
    const companyA = await getCompanyById(ownerA.companyId);
    assert.equal(companyA?.name, `Isolation test a ${runId}`);
  });

  await check("two signups get two different companies", async () => {
    assert.notEqual(ownerA.companyId, ownerB.companyId);
  });

  await check("company A's user list contains only company A's users", async () => {
    const usersInA = await getUsersInCompany(ownerA.companyId);
    assert.deepEqual(usersInA.map((user) => user.id), [ownerA.id]);
  });

  await check("company B's user list contains only company B's users", async () => {
    const usersInB = await getUsersInCompany(ownerB.companyId);
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
    const usersInA = await getUsersInCompany(ownerA.companyId);
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

  await check("12 signups at the same moment all finish", async () => {
    // If signups ever wait on each other for database connections, they hang
    // forever instead of failing. Stop the whole run then: cleanup would hang too.
    const timer = setTimeout(() => {
      console.log("FAIL  12 signups at the same moment all finish");
      console.log("      Timed out after 30s: signups are stuck waiting for database connections.");
      process.exit(1);
    }, 30_000);
    const owners = await Promise.all(
      Array.from({ length: 12 }, (_, index) => signUpTestOwner(`parallel-${index}`)),
    );
    clearTimeout(timer);
    assert.equal(new Set(owners.map((owner) => owner.companyId)).size, 12);
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
