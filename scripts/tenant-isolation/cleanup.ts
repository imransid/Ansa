// Removes everything the tenant isolation checks created: rows in every table
// for the test companies, and the dev outbox files written for them.

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { inArray, like } from "drizzle-orm";
import { db } from "@/db/client";
import {
  calls,
  categories,
  companies,
  invites,
  outgoingEmails,
  phoneLines,
  tickets,
  userCategories,
  users,
} from "@/db/schema";
import { createdEmails, runId } from "./helpers";

// Test data is removed directly here (not through /db) because the app itself
// never deletes invites, tickets, users or companies yet.
export async function cleanUpTestData() {
  const testCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(like(companies.name, `%${runId}`));
  const testCompanyIds = testCompanies.map((company) => company.id);

  if (testCompanyIds.length > 0) {
    // Order matters: emails point at tickets, tickets at calls and categories,
    // calls at phone lines, and user_categories at users and categories.
    await deleteTestEmails(testCompanyIds);
    await deleteAssignmentEmailFiles(testCompanyIds);
    // Stored files live under recordings/<companyId>/ (services/call-recordings.ts).
    for (const companyId of testCompanyIds) {
      await rm(path.join(process.cwd(), ".dev-files", "recordings", companyId), { recursive: true, force: true });
    }
    await db.delete(invites).where(inArray(invites.companyId, testCompanyIds));
    await db.delete(tickets).where(inArray(tickets.companyId, testCompanyIds));
    await db.delete(calls).where(inArray(calls.companyId, testCompanyIds));
    await db.delete(phoneLines).where(inArray(phoneLines.companyId, testCompanyIds));
    await db.delete(userCategories).where(inArray(userCategories.companyId, testCompanyIds));
    await db.delete(categories).where(inArray(categories.companyId, testCompanyIds));
  }
  if (createdEmails.length > 0) {
    await deleteVerificationEmailFiles();
    await db.delete(users).where(inArray(users.email, createdEmails));
  }
  if (testCompanyIds.length > 0) {
    await db.delete(companies).where(inArray(companies.id, testCompanyIds));
  }
}

// Removes the test companies' email rows and every dev outbox file they wrote.
// A retried email writes one file per attempt, all named after the email id.
async function deleteTestEmails(testCompanyIds: string[]) {
  const emails = await db
    .select({ id: outgoingEmails.id })
    .from(outgoingEmails)
    .where(inArray(outgoingEmails.companyId, testCompanyIds));
  const emailIds = emails.map((email) => email.id);

  const outboxDir = path.join(process.cwd(), ".dev-emails");
  const outboxFiles = await readdir(outboxDir).catch(() => []);
  for (const fileName of outboxFiles) {
    if (emailIds.some((emailId) => fileName.includes(emailId))) {
      await rm(path.join(outboxDir, fileName), { force: true });
    }
  }
  await db.delete(outgoingEmails).where(inArray(outgoingEmails.companyId, testCompanyIds));
}

// Removes the "confirm your email" files the dev outbox wrote for test users
// (their names contain the user's id, see services/email-verification.ts).
async function deleteVerificationEmailFiles() {
  const testUsers = await db.select({ id: users.id }).from(users).where(inArray(users.email, createdEmails));
  const outboxDir = path.join(process.cwd(), ".dev-emails");
  const outboxFiles = await readdir(outboxDir).catch(() => [] as string[]);
  for (const fileName of outboxFiles) {
    if (testUsers.some((user) => fileName.includes(`verify-email-${user.id}-`))) {
      await rm(path.join(outboxDir, fileName), { force: true });
    }
  }
}

// Removes the "a ticket is yours" files the dev outbox wrote for test tickets
// (their names contain the ticket's id, see services/assignment-notifications.ts).
async function deleteAssignmentEmailFiles(testCompanyIds: string[]) {
  const testTickets = await db.select({ id: tickets.id }).from(tickets).where(inArray(tickets.companyId, testCompanyIds));
  const outboxDir = path.join(process.cwd(), ".dev-emails");
  const outboxFiles = await readdir(outboxDir).catch(() => [] as string[]);
  for (const fileName of outboxFiles) {
    if (testTickets.some((ticket) => fileName.includes(`ticket-assigned-${ticket.id}-`))) {
      await rm(path.join(outboxDir, fileName), { force: true });
    }
  }
}
