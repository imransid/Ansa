// Shared pieces for the publishing queue checks (step 41): an owner with an
// approved draft and connected accounts, scheduling and running posts the
// way the pages and the runners do, fake platforms answering the posts,
// and what the database holds. No real platform is ever asked: stand-in
// accounts write to .dev-social/ (their files removed at the end, as the
// social checks' are), the others answer through fake fetches.

import assert from "node:assert/strict";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cofounderActivity, publishJobs, socialConnections } from "@/db/schema";
import type { ModelResult } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import type { SocialPlatform } from "@/lib/social-platforms";
import { runPublishJobsNow, type PublishRunOptions } from "@/services/publish-runs";
import { scheduleDraftForSession } from "@/services/publish-scheduling";
import { connectStandInAccountForSession } from "@/services/social-connect";
import { approveDraft, draftAnswer, draftRow, generatedDraftId, LINKEDIN_POST, makeReadyForDrafts } from "./content-studio-helpers";
import { sessionFor, signUpTestOwner } from "./helpers";
import { collectingAfter } from "./media-helpers";
import { connectFully, connectionRows, everyPlatformReal, linkedInConnects, trackStandInPost } from "./social-helpers";

// A draft the AI wrote whose only claim is backed by a confirmed fact (the
// description makeReadyForPlan types): nothing an owner must check, so an
// auto-publish rule may send it.
export function cleanDraftAnswer(): ModelResult {
  return draftAnswer({ claims: [{ text: "The bakery bakes sourdough bread in Lisbon.", fact_topics: ["description"] }] });
}

// An owner whose company is ready for drafts, with one LinkedIn text post
// the AI wrote, approved (its claims checked).
export async function ownerWithApprovedDraft(label: string) {
  const owner = sessionFor(await signUpTestOwner(label));
  await makeReadyForDrafts(owner);
  const draftId = await generatedDraftId(owner, LINKEDIN_POST);
  assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
  return { owner, draftId };
}

// One approved LinkedIn post for an owner signed up by the check itself
// (their company made ready for drafts first): its id.
export async function approvedDraftOf(owner: SessionContext): Promise<string> {
  await makeReadyForDrafts(owner);
  const draftId = await generatedDraftId(owner, LINKEDIN_POST);
  assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
  return draftId;
}

// One more approved LinkedIn post of the same company.
export async function anotherApprovedDraft(owner: SessionContext, topic: string): Promise<string> {
  const draftId = await generatedDraftId(owner, { ...LINKEDIN_POST, topic });
  assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
  return draftId;
}

// The company's stand-in account of a platform, connected by its owner: its id.
export async function standInAccount(owner: SessionContext, platform: SocialPlatform = "linkedin"): Promise<string> {
  assert.deepEqual(await connectStandInAccountForSession(owner, { platform }), { ok: true });
  const row = (await connectionRows(owner.companyId)).find((connection) => connection.platform === platform && connection.isStandIn);
  assert.ok(row, `no stand-in ${platform} account`);
  return row.id;
}

// A LinkedIn member connected through its (fake) consent round, as a real
// account: posts to it go through the LinkedIn adapter and a fake fetch.
export async function realLinkedInAccount(owner: SessionContext, sub: string): Promise<string> {
  await connectFully(owner, "linkedin", linkedInConnects(sub));
  const row = (await connectionRows(owner.companyId)).find((connection) => connection.externalAccountId === sub);
  assert.ok(row, "no LinkedIn account");
  return row.id;
}

// The options that send posts through a fake platform as if it were real.
export function throughFakePlatform(fetchFn: (url: string, init: RequestInit) => Promise<Response>): PublishRunOptions {
  return { social: { modeOf: everyPlatformReal, fetchFn } };
}

// LinkedIn's answer to a post it made: 201 with the post's id.
export function linkedInPosted(id: string): Response {
  return new Response(null, { status: 201, headers: { "x-restli-id": id } });
}

// Schedules as the draft's page does, at the draft's version now, for now or
// a time. The run after the answer is collected (settle() runs it).
export async function schedule(
  owner: SessionContext,
  draftId: string,
  connectionIds: string[],
  when: "now" | Date = "now",
  options: { withoutApproval?: boolean; run?: PublishRunOptions } = {},
) {
  const after = collectingAfter();
  const input = {
    draftId,
    version: String((await draftRow(draftId)).version),
    connectionIds,
    when: when === "now" ? "now" : "later",
    scheduledFor: when === "now" ? "" : when.toISOString(),
    withoutApproval: options.withoutApproval ? "on" : null,
  };
  const result = await scheduleDraftForSession(owner, input, after.run, options.run ?? {});
  return { result, after };
}

// Schedules for later, which must work, and returns the job ids.
export async function scheduledJobIds(owner: SessionContext, draftId: string, connectionIds: string[], at = inMinutes(60)): Promise<string[]> {
  const { result } = await schedule(owner, draftId, connectionIds, at);
  assert.deepEqual(result, { ok: true });
  const jobs = await jobRowsOfDraft(draftId);
  return jobs.filter((job) => job.status === "queued").map((job) => job.id);
}

export function inMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

// Makes a waiting job due now (as if its time came), so a run takes it.
export async function makeDue(jobId: string): Promise<void> {
  await db.update(publishJobs).set({ runAfter: sql`now() - interval '1 second'`, scheduledFor: sql`now() - interval '1 second'` }).where(eq(publishJobs.id, jobId));
}

// Runs one company's job now, as the run after an answer does.
export async function runNow(owner: SessionContext, jobId: string, options: PublishRunOptions = {}) {
  const [outcome] = await runPublishJobsNow(owner.companyId, [jobId], options);
  return outcome;
}

export async function jobRow(jobId: string) {
  const [row] = await db.select().from(publishJobs).where(eq(publishJobs.id, jobId));
  assert.ok(row, "the job is not in the database");
  return row;
}

export async function jobRowsOfDraft(draftId: string) {
  return db.select().from(publishJobs).where(eq(publishJobs.draftId, draftId)).orderBy(asc(publishJobs.createdAt), asc(publishJobs.id));
}

// One company's activity rows, oldest first (as they happened).
export async function activityRows(companyId: string) {
  return db.select().from(cofounderActivity).where(eq(cofounderActivity.companyId, companyId)).orderBy(asc(cofounderActivity.createdAt));
}

// The actions recorded about one job, oldest first.
export async function actionsOfJob(companyId: string, jobId: string): Promise<string[]> {
  const rows = await db
    .select({ action: cofounderActivity.action })
    .from(cofounderActivity)
    .where(and(eq(cofounderActivity.companyId, companyId), eq(cofounderActivity.jobId, jobId)))
    .orderBy(asc(cofounderActivity.createdAt));
  return rows.map((row) => row.action);
}

// Notes the file a stand-in post wrote for this job, so it is removed at the end.
export async function trackStandInJob(jobId: string): Promise<string | null> {
  const job = await jobRow(jobId);
  if (job.status !== "published" || !job.externalPostId) {
    return null;
  }
  const [connection] = await db.select({ platform: socialConnections.platform }).from(socialConnections).where(eq(socialConnections.id, job.connectionId));
  return trackStandInPost(connection.platform, { kind: "published", externalPostId: job.externalPostId, url: null });
}
