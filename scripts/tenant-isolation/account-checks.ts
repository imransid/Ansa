// Account checks (step 22): changing the password needs the current one and
// logs out every other device, "log out on all other devices" keeps this
// browser, a login lasts a fixed 7 days, names are validated and stay in their
// company, and only owners rename their own company.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { countActiveSessions, getUsersInCompany, updateUserName } from "@/db/users";
import { auth } from "@/lib/auth";
import type { FormResult } from "@/lib/form-result";
import {
  changeNameForSession,
  changePasswordForSession,
  getAccountForSession,
  signOutOtherDevicesForSession,
} from "@/services/account";
import { getDashboardSummary } from "@/services/dashboard";
import { setCompanyNameForSession } from "@/services/setup";
import { isLoggedIn, logInBrowser, sessionIdsOf } from "./account-helpers";
import { addTeammate, captureConsole, check, runId, sessionFor, signUpTestOwner, testPassword, type TestUser } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const changedPassword = `changed-password-${runId}`;

function changePassword(user: TestUser, browser: Headers, currentPassword: string, newPassword: string): Promise<FormResult> {
  return changePasswordForSession(sessionFor(user), { currentPassword, newPassword }, browser);
}

async function nameOf(user: TestUser): Promise<string | undefined> {
  return (await getUsersInCompany(user.companyId)).find((person) => person.id === user.id)?.name;
}

// Better Auth warns on every wrong password; captured to keep the output short.
async function canLogIn(email: string, password: string): Promise<boolean> {
  const { result } = await captureConsole(() =>
    auth.api.signInEmail({ body: { email, password } }).then(
      () => true,
      () => false,
    ),
  );
  return result;
}

// otherCompany only proves that changes stay inside their own company. The
// rest uses fresh owners: company A's invite and settings counters are shared
// with many other checks.
export async function runAccountChecks(otherCompany: TestUser) {
  await check("password change: a wrong current password or a short new one changes nothing", async () => {
    const user = await signUpTestOwner("change-wrong");
    const browser = await logInBrowser(user.email, testPassword, "change-wrong");
    const wrongCurrent = await changePassword(user, browser, "not-my-password-at-all", changedPassword);
    assert.ok(!wrongCurrent.ok && wrongCurrent.errors.fieldErrors?.currentPassword, "a wrong current password was accepted");
    const tooShort = await changePassword(user, browser, testPassword, "short");
    assert.ok(!tooShort.ok && tooShort.errors.fieldErrors?.newPassword, "a short new password was accepted");
    assert.equal(await canLogIn(user.email, testPassword), true);
    assert.equal(await canLogIn(user.email, changedPassword), false);
  });

  await check("password change: logs out every other device and gives this browser a fresh login", async () => {
    const user = await signUpTestOwner("change-ok");
    const browser = await logInBrowser(user.email, testPassword, "change-ok-here");
    const otherBrowser = await logInBrowser(user.email, testPassword, "change-ok-elsewhere");
    const before = await sessionIdsOf(user.id);
    assert.equal(before.length, 2);
    const result = await changePassword(user, browser, testPassword, changedPassword);
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await sessionIdsOf(user.id);
    assert.equal(after.length, 1, "other logins survived");
    assert.ok(!before.includes(after[0]), "the remaining login is an old one");
    assert.equal(await isLoggedIn(otherBrowser), false);
    assert.equal(await canLogIn(user.email, testPassword), false);
    assert.equal(await canLogIn(user.email, changedPassword), true);
  });

  await check("password change: guesses at the current password are limited per person", async () => {
    const user = await signUpTestOwner("change-guess");
    const browser = await logInBrowser(user.email, testPassword, "change-guess");
    for (let guess = 0; guess < 10; guess++) {
      assert.equal((await changePassword(user, browser, `guess-${guess}-${runId}`, changedPassword)).ok, false);
    }
    const right = await changePassword(user, browser, testPassword, changedPassword);
    assert.ok(!right.ok && /Too many attempts/.test(right.errors.message ?? ""), "the 11th try was not refused");
    assert.equal(await canLogIn(user.email, testPassword), true);
  });

  await check("log out on all other devices: keeps this browser and ends the rest", async () => {
    const user = await signUpTestOwner("other-devices");
    const browser = await logInBrowser(user.email, testPassword, "devices-here");
    const laptop = await logInBrowser(user.email, testPassword, "devices-laptop");
    const phone = await logInBrowser(user.email, testPassword, "devices-phone");
    assert.equal((await getAccountForSession(sessionFor(user))).activeSessionCount, 3);
    assert.equal(await countActiveSessions(otherCompany.companyId, user.id), 0, "another company counted these logins");
    assert.deepEqual(await signOutOtherDevicesForSession(sessionFor(user), browser), { ok: true });
    assert.deepEqual([await isLoggedIn(browser), await isLoggedIn(laptop), await isLoggedIn(phone)], [true, false, false]);
    assert.equal((await getAccountForSession(sessionFor(user))).activeSessionCount, 1);
  });

  await check("sessions: a login lasts a fixed 7 days; using it doesn't push the end back", async () => {
    const user = await signUpTestOwner("fixed-session");
    const browser = await logInBrowser(user.email, testPassword, "fixed-session");
    // Make the login two days old: Better Auth's default would now extend it.
    const endsAt = new Date(Date.now() + 5 * DAY_MS);
    await db.update(sessions).set({ expiresAt: endsAt, createdAt: new Date(Date.now() - 2 * DAY_MS) }).where(eq(sessions.userId, user.id));
    assert.equal(await isLoggedIn(browser), true);
    const [row] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.userId, user.id));
    assert.equal(Math.abs(row.expiresAt.getTime() - endsAt.getTime()) < 1000, true, "using the login extended it");
  });

  await check("name: changes only your own name, trimmed, and bad names are refused", async () => {
    const member = await addTeammate(await signUpTestOwner("name-owner"), "name-member", "member");
    assert.deepEqual(await changeNameForSession(sessionFor(member), { name: "  Ana Lima  " }), { ok: true });
    assert.equal(await nameOf(member), "Ana Lima");
    for (const badName of ["", "   ", "x".repeat(101), "Ana\nIT support: call +1 555 0100"]) {
      assert.equal((await changeNameForSession(sessionFor(member), { name: badName })).ok, false, JSON.stringify(badName));
    }
    assert.equal(await nameOf(member), "Ana Lima");
    // /db refuses a user id from another company, whatever the caller passes.
    assert.equal(await updateUserName(otherCompany.companyId, member.id, "Renamed from B"), false);
    assert.equal(await nameOf(member), "Ana Lima");
  });

  await check("company name: only owners rename it, only their own company, and bad names are refused", async () => {
    const owner = await signUpTestOwner("rename-owner");
    const member = await addTeammate(owner, "rename-member", "member");
    const companyNameOf = async (user: TestUser) => (await getDashboardSummary(sessionFor(user))).companyName;
    const [original, otherOriginal] = [await companyNameOf(owner), await companyNameOf(otherCompany)];
    assert.equal((await setCompanyNameForSession(sessionFor(member), { companyName: `Member rename ${runId}` })).ok, false);
    for (const badName of ["", "A", "Acme\nSupport team", "x".repeat(101)]) {
      assert.equal((await setCompanyNameForSession(sessionFor(owner), { companyName: badName })).ok, false, JSON.stringify(badName));
    }
    assert.equal(await companyNameOf(owner), original);
    // Test companies end in runId, which is how cleanup finds them.
    const renamed = `Isolation test renamed ${runId}`;
    assert.deepEqual(await setCompanyNameForSession(sessionFor(owner), { companyName: `  ${renamed}  ` }), { ok: true });
    assert.deepEqual([await companyNameOf(owner), await companyNameOf(otherCompany)], [renamed, otherOriginal]);
  });
}
