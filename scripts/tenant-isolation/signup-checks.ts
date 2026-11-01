// Signup and user checks: each signup gets its own company, users stay inside
// their company, a request cannot pick its own company or role, and names
// can't carry line breaks into emails.

import assert from "node:assert/strict";
import { getCompanyById } from "@/db/companies";
import { getUsersInCompany } from "@/db/users";
import { auth } from "@/lib/auth";
import { NEW_COMPANY_NAME } from "@/lib/restaurant-setup";
import { signupSchema } from "@/lib/validation/auth";
import { joinWithInviteSchema } from "@/lib/validation/invites";
import { businessSectionSchema } from "@/lib/validation/restaurant-setup";
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
    // If signups ever wait on each other for database connections, they fail
    // once the pool's 10-second wait runs out (db/client.ts), or hang if that
    // limit is ever removed. Stop the whole run then: cleanup would hang too.
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

  await check("signup asks for no business name: the new owner's company is a business named 'New business' until setup, and nothing in the request names it", async () => {
    const email = testEmail("no-company");
    // Better Auth passes fields its types don't list through to the hook at run time.
    const body = { name: "No company", email, password: testPassword, companyName: `Smuggled name ${runId}` };
    const { user } = await auth.api.signUpEmail({ body });
    assert.equal(user.role, "owner");
    const company = await getCompanyById(String(user.companyId));
    assert.deepEqual(
      [company?.name, company?.kind, company?.businessType, company?.setupProgress, company?.setupFinishedAt],
      [NEW_COMPANY_NAME, "business", null, 0, null],
    );
  });

  await check("names with line breaks or other control characters are refused", async () => {
    const valid = { name: "Ana", email: "ana@example.test", password: testPassword };
    for (const badName of ["Ana\nYour account is locked", "Ana\u0000"]) {
      assert.equal(signupSchema.safeParse({ ...valid, name: badName }).success, false, `accepted ${JSON.stringify(badName)}`);
    }
    // The business name, typed in setup's first step (step 45), is a sender
    // name of customer emails: no line breaks or tabs either.
    const business = { kind: "business", companyName: "Acme", businessType: "restaurant", description: "Pizza and pasta." };
    for (const badCompanyName of ["Acme\r\nBcc: someone@example.test", "Acme\tCo"]) {
      const parsed = businessSectionSchema.safeParse({ ...business, companyName: badCompanyName });
      assert.equal(parsed.success, false, `accepted ${JSON.stringify(badCompanyName)}`);
    }
    const joinInput = { inviteToken: "a".repeat(43), name: "Bea\nCall us", email: valid.email, password: testPassword };
    assert.equal(joinWithInviteSchema.safeParse(joinInput).success, false);
    // Ordinary names, accents and spaces around them are fine (the spaces are trimmed).
    assert.equal(signupSchema.safeParse({ ...valid, name: "  Zoë Ünal-O'Brien  " }).success, true);
  });
}
