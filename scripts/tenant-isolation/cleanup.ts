// Removes everything the tenant isolation checks created: rows in every table
// for the test companies, and the dev outbox files written for them.

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { and, inArray, isNotNull, like } from "drizzle-orm";
import { db } from "@/db/client";
import {
  autopublishRules,
  businessFacts,
  calls,
  categories,
  cofounderActivity,
  companies,
  companyBilling,
  companyDocuments,
  contentDrafts,
  inboundAddresses,
  inboundEmails,
  invites,
  knowledgeArticles,
  knowledgeChunks,
  knowledgeLookups,
  marketingPlans,
  mediaAssets,
  mediaGenerationJobs,
  oauthStates,
  onboardingMessages,
  outgoingEmails,
  performanceReviews,
  phoneLines,
  postMetrics,
  publishJobs,
  socialConnections,
  ticketActivity,
  tickets,
  userCategories,
  users,
  verifications,
} from "@/db/schema";
import { createdEmails, runId, unconfirmedAccountIds } from "./helpers";

// Test data is removed directly here (not through /db) because the app itself
// never deletes invites, tickets or companies, and keeps the people it
// removes from a team (it only deletes accounts that never confirmed).
export async function cleanUpTestData() {
  const testCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(like(companies.name, `%${runId}`));
  const testCompanyIds = testCompanies.map((company) => company.id);

  if (testCompanyIds.length > 0) {
    // Order matters: emails, ticket history and knowledge articles point at
    // tickets (history and articles at users too), tickets at calls and categories, calls at phone lines (and
    // at the user who escalated one, step 31), and user_categories at users
    // and categories.
    await deleteTestEmails(testCompanyIds);
    await deleteAssignmentEmailFiles(testCompanyIds);
    // Stored files live under recordings/<companyId>/ (services/call-recordings.ts),
    // documents/<companyId>/ (services/documents.ts) and media/<companyId>/
    // (services/media-files.ts).
    for (const companyId of testCompanyIds) {
      await rm(path.join(process.cwd(), ".dev-files", "recordings", companyId), { recursive: true, force: true });
      await rm(path.join(process.cwd(), ".dev-files", "documents", companyId), { recursive: true, force: true });
      await rm(path.join(process.cwd(), ".dev-files", "media", companyId), { recursive: true, force: true });
    }
    await db.delete(knowledgeLookups).where(inArray(knowledgeLookups.companyId, testCompanyIds));
    // The Co-Founder's activity log points at drafts, posts, accounts, rules,
    // plans and people; posts at drafts, accounts, rules and people (step 41);
    // post numbers at posts (step 42).
    await db.delete(cofounderActivity).where(inArray(cofounderActivity.companyId, testCompanyIds));
    await db.delete(postMetrics).where(inArray(postMetrics.companyId, testCompanyIds));
    await db.delete(publishJobs).where(inArray(publishJobs.companyId, testCompanyIds));
    await db.delete(autopublishRules).where(inArray(autopublishRules.companyId, testCompanyIds));
    // Social accounts and connection attempts point at the people who made them.
    await db.delete(socialConnections).where(inArray(socialConnections.companyId, testCompanyIds));
    await db.delete(oauthStates).where(inArray(oauthStates.companyId, testCompanyIds));
    await deleteTestMedia(testCompanyIds);
    // The Co-Founder's facts, interview, marketing plans and content drafts
    // point at the people who confirmed, wrote or made them; drafts also at
    // the plan version they were written from.
    await db.delete(contentDrafts).where(inArray(contentDrafts.companyId, testCompanyIds));
    await db.delete(marketingPlans).where(inArray(marketingPlans.companyId, testCompanyIds));
    // Plans point at the performance review they read (step 42).
    await db.delete(performanceReviews).where(inArray(performanceReviews.companyId, testCompanyIds));
    await db.delete(onboardingMessages).where(inArray(onboardingMessages.companyId, testCompanyIds));
    await db.delete(businessFacts).where(inArray(businessFacts.companyId, testCompanyIds));
    // Knowledge articles point at documents, tickets and users; their pieces at them.
    await db.delete(knowledgeChunks).where(inArray(knowledgeChunks.companyId, testCompanyIds));
    await db.delete(knowledgeArticles).where(inArray(knowledgeArticles.companyId, testCompanyIds));
    await db.delete(companyDocuments).where(inArray(companyDocuments.companyId, testCompanyIds));
    await db.delete(companyBilling).where(inArray(companyBilling.companyId, testCompanyIds));
    await db.delete(invites).where(inArray(invites.companyId, testCompanyIds));
    await db.delete(inboundEmails).where(inArray(inboundEmails.companyId, testCompanyIds));
    await db.delete(inboundAddresses).where(inArray(inboundAddresses.companyId, testCompanyIds));
    await db.delete(ticketActivity).where(inArray(ticketActivity.companyId, testCompanyIds));
    await db.delete(tickets).where(inArray(tickets.companyId, testCompanyIds));
    await db.delete(calls).where(inArray(calls.companyId, testCompanyIds));
    await db.delete(phoneLines).where(inArray(phoneLines.companyId, testCompanyIds));
    await db.delete(userCategories).where(inArray(userCategories.companyId, testCompanyIds));
    await db.delete(categories).where(inArray(categories.companyId, testCompanyIds));
  }
  if (createdEmails.length > 0) {
    await deleteAccountEmailFiles();
    await deletePasswordResetLinks();
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

// Removes the "confirm your email", "you already have an account" and "reset
// your password" files the dev outbox wrote for test users (their names
// contain the user's id, see services/email-verification.ts and
// services/password-reset-email.ts), including accounts the app deleted.
async function deleteAccountEmailFiles() {
  const testUsers = await db.select({ id: users.id }).from(users).where(inArray(users.email, createdEmails));
  const userIds = [...testUsers.map((user) => user.id), ...unconfirmedAccountIds];
  const fileNameParts = userIds.flatMap((userId) => [
    `verify-email-${userId}-`,
    `existing-account-${userId}-`,
    `reset-password-${userId}-`,
  ]);
  const outboxDir = path.join(process.cwd(), ".dev-emails");
  const outboxFiles = await readdir(outboxDir).catch(() => [] as string[]);
  for (const fileName of outboxFiles) {
    if (fileNameParts.some((part) => fileName.includes(part))) {
      await rm(path.join(outboxDir, fileName), { force: true });
    }
  }
}

// Removes the test users' reset links. Better Auth keeps them in its
// verifications table with the user's id as the value, and no foreign key.
async function deletePasswordResetLinks() {
  const testUsers = await db.select({ id: users.id }).from(users).where(inArray(users.email, createdEmails));
  if (testUsers.length > 0) {
    await db.delete(verifications).where(inArray(verifications.value, testUsers.map((user) => user.id)));
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

// Removes the test companies' media library (step 39). Drafts point at
// assets, assets at the jobs that made them, and jobs at assets and drafts,
// so the links go first: what each job made counts as deleted since.
async function deleteTestMedia(testCompanyIds: string[]) {
  await db.update(contentDrafts).set({ mediaAssetId: null }).where(inArray(contentDrafts.companyId, testCompanyIds));
  await db
    .update(mediaGenerationJobs)
    .set({ assetId: null, assetDeletedAt: new Date() })
    .where(and(inArray(mediaGenerationJobs.companyId, testCompanyIds), isNotNull(mediaGenerationJobs.assetId)));
  await db.delete(mediaAssets).where(inArray(mediaAssets.companyId, testCompanyIds));
  await db.delete(mediaGenerationJobs).where(inArray(mediaGenerationJobs.companyId, testCompanyIds));
}
