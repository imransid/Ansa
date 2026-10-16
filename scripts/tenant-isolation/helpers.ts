// Shared pieces for the tenant isolation checks: test data and a tiny check runner.

import { randomUUID } from "node:crypto";
import { inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, tickets, users } from "@/db/schema";
import { auth } from "@/lib/auth";

// Every company and email created by one run contains this id, so cleanUp
// can find exactly what this run created and nothing else.
export const runId = randomUUID().slice(0, 8);
export const testPassword = "isolation-test-password";
const createdEmails: string[] = [];
let failures = 0;

export type TestOwner = {
  id: string;
  email: string;
  companyId: string;
  role: unknown;
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
// types don't list (companyName, or a smuggled companyId / role).
export function signUpWithBody(body: SignupBody) {
  return auth.api.signUpEmail({ body });
}

export async function signUpTestOwner(label: string): Promise<TestOwner> {
  const { user } = await signUpWithBody({
    name: `Owner ${label}`,
    email: testEmail(label),
    password: testPassword,
    companyName: `Isolation test ${label} ${runId}`,
  });
  if (!user.companyId) {
    throw new Error(`Signup for owner ${label} returned no companyId`);
  }
  return { id: user.id, email: user.email, companyId: user.companyId, role: user.role };
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
// never deletes tickets, users or companies yet.
export async function cleanUpTestData() {
  const testCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(like(companies.name, `%${runId}`));
  const testCompanyIds = testCompanies.map((company) => company.id);

  if (testCompanyIds.length > 0) {
    await db.delete(tickets).where(inArray(tickets.companyId, testCompanyIds));
  }
  if (createdEmails.length > 0) {
    await db.delete(users).where(inArray(users.email, createdEmails));
  }
  if (testCompanyIds.length > 0) {
    await db.delete(companies).where(inArray(companies.id, testCompanyIds));
  }
}
