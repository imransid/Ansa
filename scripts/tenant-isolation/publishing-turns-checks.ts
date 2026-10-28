// Publishing queue checks (step 41 review), the runners' fairness: the
// companies with due posts take turns (one post each per round, the
// longest waiting first), so one company's long queue never takes a run
// from the others; a company past its daily limit has one post held back
// per run, before its account is made ready, and gets no more turns in
// that run. Through the real services and /db; fake platforms only.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { publishJobs, socialConnections } from "@/db/schema";
import { runDuePublishJobs } from "@/services/publish-runs";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { captureConsole, check, runId } from "./helpers";
import { actionsOfJob, anotherApprovedDraft, jobRow, linkedInPosted, ownerWithApprovedDraft, realLinkedInAccount, scheduledJobIds, throughFakePlatform } from "./publishing-helpers";
import { connectionRows, fakePlatform } from "./social-helpers";

// Makes a waiting job due this many minutes ago.
async function dueMinutesAgo(jobId: string, minutes: number): Promise<void> {
  const at = sql`now() - make_interval(mins => ${minutes})`;
  await db.update(publishJobs).set({ runAfter: at, scheduledFor: at }).where(eq(publishJobs.id, jobId));
}

// A busy company with three due posts, the longest waiting of all, and a
// quiet one with a single post due later.
async function twoCompaniesWithDuePosts(label: string) {
  const busy = await ownerWithApprovedDraft(`turns-busy-${label}`);
  const quiet = await ownerWithApprovedDraft(`turns-quiet-${label}`);
  const busySub = `busy${runId}${label}`;
  const quietSub = `quiet${runId}${label}`;
  const busyAccount = await realLinkedInAccount(busy.owner, busySub);
  const quietAccount = await realLinkedInAccount(quiet.owner, quietSub);
  const busyJobs = [(await scheduledJobIds(busy.owner, busy.draftId, [busyAccount]))[0]];
  for (const topic of ["Second", "Third"]) {
    const draftId = await anotherApprovedDraft(busy.owner, `${topic} of a long queue ${runId} ${label}`);
    busyJobs.push((await scheduledJobIds(busy.owner, draftId, [busyAccount]))[0]);
  }
  const [quietJob] = await scheduledJobIds(quiet.owner, quiet.draftId, [quietAccount]);
  for (const [index, jobId] of busyJobs.entries()) {
    await dueMinutesAgo(jobId, 30 - index);
  }
  await dueMinutesAgo(quietJob, 10);
  const companies = [busy.owner.companyId, quiet.owner.companyId];
  return { busy, busySub, quietSub, busyAccount, busyJobs, quietJob, companies };
}

// Who each post a fake LinkedIn received was made for (its member id).
function authorsOf(requests: { body: unknown }[]): string[] {
  return requests.map((request) => String(JSON.parse(String(request.body)).author).replace("urn:li:person:", ""));
}

export async function runPublishingTurnsChecks() {
  await check("publish runs: the companies with due posts take turns, one post each per round, the longest waiting first: another company's newer post goes out right after the first of a long queue, not after all of it", async () => {
    const { busySub, quietSub, busyJobs, quietJob, companies } = await twoCompaniesWithDuePosts("tr");
    const linkedIn = fakePlatform([1, 2, 3, 4].map((post) => linkedInPosted(`urn:li:share:700000000000000460${post}`)));
    const counts = await runDuePublishJobs(Date.now(), { ...throughFakePlatform(linkedIn.fetchFn), onlyCompanyIds: companies });
    assert.equal(counts.published, 4);
    assert.deepEqual(authorsOf(linkedIn.requests), [busySub, quietSub, busySub, busySub]);
    const statuses = await Promise.all([...busyJobs, quietJob].map(async (jobId) => (await jobRow(jobId)).status));
    assert.deepEqual(statuses, ["published", "published", "published", "published"]);
  });

  await check("publish runs: past its posts for the day a company has one post held back per run, before its account is made ready (an expired permission isn't even looked at), and no more turns in that run: its other due posts stay as they were, and the other company's post goes out", async () => {
    const { busy, quietSub, busyAccount, busyJobs, quietJob, companies } = await twoCompaniesWithDuePosts("dl");
    for (let attempt = 0; attempt < RATE_LIMITS.publishAttemptsPerCompany.maxAttempts; attempt++) {
      await isOverRateLimit("publish-attempts", busy.owner.companyId, RATE_LIMITS.publishAttemptsPerCompany);
    }
    // Ran out an hour ago and LinkedIn gives no way to renew it: making the
    // account ready would mark it for reconnecting and fail the post.
    await db.update(socialConnections).set({ accessExpiresAt: sql`now() - interval '1 hour'` }).where(eq(socialConnections.id, busyAccount));
    const waitingOf = async (jobId: string) => {
      const job = await jobRow(jobId);
      return [job.status, job.lastError, job.attempts, job.runAfter.toISOString()];
    };
    const before = await Promise.all(busyJobs.slice(1).map(waitingOf));
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000004701")]);
    const run = await captureConsole(() => runDuePublishJobs(Date.now(), { ...throughFakePlatform(linkedIn.fetchFn), onlyCompanyIds: companies }));
    assert.deepEqual([run.result.requeued, run.result.published, run.result.failed], [1, 1, 0]);
    assert.deepEqual(run.logs, ["Publish job held back: linkedin daily_limit"]);
    assert.deepEqual(authorsOf(linkedIn.requests), [quietSub]);
    const held = await jobRow(busyJobs[0]);
    assert.deepEqual([held.status, held.lastError, held.attempts], ["queued", "daily_limit", 0]);
    assert.deepEqual(await Promise.all(busyJobs.slice(1).map(waitingOf)), before, "a post of a company past its limit was claimed again in the same run");
    for (const jobId of busyJobs.slice(1)) {
      assert.deepEqual(await actionsOfJob(busy.owner.companyId, jobId), ["scheduled"]);
    }
    assert.equal((await jobRow(quietJob)).status, "published");
    const account = (await connectionRows(busy.owner.companyId)).find((row) => row.id === busyAccount);
    assert.deepEqual([account?.status, account?.lastError], ["connected", null], "the held-back post made its account ready first");
  });
}
