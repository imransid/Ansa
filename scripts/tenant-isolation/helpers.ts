// Shared pieces for the tenant isolation checks: test data and a tiny check runner.

import { randomUUID } from "node:crypto";
import { inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, invites, tickets, userRoles, users, type UserRole } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { SessionContext } from "@/lib/session";
import { createInviteForSession } from "@/services/invites";

// Every company and email created by one run contains this id, so cleanUp
// can find exactly what this run created and nothing else.
export const runId = randomUUID().slice(0, 8);
export const testPassword = "isolation-test-password";
const createdEmails: string[] = [];
let failures = 0;

export type TestUser = {
  id: string;
  email: string;
  companyId: string;
  role: UserRole;
};

export function testEmail(label: string): string {
  const email = `isolation-${label}-${runId}@example.test`;
  createdEmails.push(email);
  return email;
}

type SignupBody = { name: string; email: string; password: string } & Record<
  string,
  unknown
>;

// Calls Better Auth's signup the way a real request would, including fields its
// types don't list (companyName, inviteToken, or a smuggled companyId / role).
export async function signUpWithBody(body: SignupBody): Promise<TestUser> {
  const { user } = await auth.api.signUpEmail({ body });
  const role = userRoles.find((knownRole) => knownRole === user.role);
  if (!user.companyId || !role) {
    throw new Error(`Signup for ${body.email} returned no company or an unknown role`);
  }
  return { id: user.id, email: user.email, companyId: user.companyId, role };
}

export async function signUpTestOwner(label: string): Promise<TestUser> {
  return signUpWithBody({
    name: `Owner ${label}`,
    email: testEmail(label),
    password: testPassword,
    companyName: `Isolation test ${label} ${runId}`,
  });
}

// Creates an invite as `owner` and returns the token from the link.
export async function inviteAs(owner: TestUser, email: string, role: UserRole) {
  const result = await createInviteForSession(sessionFor(owner), { email, role });
  if (!result.ok) {
    throw new Error(`Could not create invite: ${JSON.stringify(result.errors)}`);
  }
  return result.inviteLink.split("#")[1];
}

export function joinWithToken(email: string, inviteToken: string): Promise<TestUser> {
  return signUpWithBody({ name: "Invited", email, password: testPassword, inviteToken });
}

// Adds a new person to the owner's company through a real invite.
export async function addTeammate(owner: TestUser, label: string, role: UserRole): Promise<TestUser> {
  const email = testEmail(label);
  return joinWithToken(email, await inviteAs(owner, email, role));
}

// Services only read companyId, userId and role from the session; the rest is filler.
export function sessionFor(user: TestUser): SessionContext {
  return { userId: user.id, companyId: user.companyId, role: user.role, name: "Test", email: user.email };
}

export async function check(description: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${description}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${description}`);
    console.log(`      ${error instanceof Error ? error.message : error}`);
  }
}

export function getFailureCount(): number {
  return failures;
}

// Test data is removed directly here (not through /db) because the app itself
// never deletes invites, tickets, users or companies yet.
export async function cleanUpTestData() {
  const testCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(like(companies.name, `%${runId}`));
  const testCompanyIds = testCompanies.map((company) => company.id);

  if (testCompanyIds.length > 0) {
    await db.delete(invites).where(inArray(invites.companyId, testCompanyIds));
    await db.delete(tickets).where(inArray(tickets.companyId, testCompanyIds));
  }
  if (createdEmails.length > 0) {
    await db.delete(users).where(inArray(users.email, createdEmails));
  }
  if (testCompanyIds.length > 0) {
    await db.delete(companies).where(inArray(companies.id, testCompanyIds));
  }
}
