// Publishing queue checks (step 41), the claims: five runners at once
// claim a due post once; one claim takes exactly one post, the longest
// waiting; a post cut off while sending goes to a person and is never sent
// again; a run that lost its post never writes over the next run's; the
// platform is asked only while a claim has time for its longest answer.
// Through the real services and /db; fake platforms only.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { recordJobFailed, recordJobNeedsAttention, recordJobPublished, requeueClaimedJob } from "@/db/publish-outcomes";
import { readJobForPublishing } from "@/db/publish-run-read";
import { claimNextDuePublishJob, claimPublishJob, type PublishClaim } from "@/db/publish-runs";
import { publishJobs } from "@/db/schema";
import { STALE_PUBLISHING_MINUTES } from "@/lib/publishing/limits";
import { LONGEST_PUBLISH_MS } from "@/lib/social-publishing";
import { LATEST_SEND_START_MS, sendClaimedJob } from "@/services/publish-attempt";
import { retryPublishJobForSession } from "@/services/publish-job-actions";
import { LONGEST_PUBLISH_RUN_MS, runDuePublishJobs } from "@/services/publish-runs";
import { draftRow } from "./content-studio-helpers";
import { check, runId } from "./helpers";
import { neverRun } from "./media-helpers";
import {
  actionsOfJob,
  anotherApprovedDraft,
  jobRow,
  linkedInPosted,
  makeDue,
  ownerWithApprovedDraft,
  realLinkedInAccount,
  runNow,
  scheduledJobIds,
  throughFakePlatform,
} from "./publishing-helpers";
import { fakePlatform, noPlatform } from "./social-helpers";

// Every outcome a run can write about its claim: true for each that landed.
async function writeEveryOutcome(claim: PublishClaim): Promise<boolean[]> {
  return [
    await recordJobPublished(claim, { externalPostId: "urn:li:share:7000000000000000391", url: null }),
    await recordJobFailed(claim, "network_error"),
    await recordJobNeedsAttention(claim, "server_error"),
    await requeueClaimedJob(claim, { waitSeconds: 60, code: "rate_limited", countsAsTry: true }),
  ];
}

export async function runPublishingClaimChecks() {
  await check("publishing: five runners at the same moment claim a due post once: one request to the platform, one published post, one try", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-race");
    const account = await realLinkedInAccount(owner, `member${runId}race`);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    await makeDue(jobId);
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000301"), linkedInPosted("urn:li:share:7000000000000000302")]);
    const options = { ...throughFakePlatform(linkedIn.fetchFn), onlyCompanyIds: [owner.companyId] };
    const [first, second, third, due, otherDue] = await Promise.all([
      runNow(owner, jobId, options),
      runNow(owner, jobId, options),
      runNow(owner, jobId, options),
      runDuePublishJobs(Date.now(), options),
      runDuePublishJobs(Date.now(), options),
    ]);
    const published = [first, second, third].filter((outcome) => outcome === "published").length + due.published + otherDue.published;
    assert.deepEqual([published, linkedIn.requests.length], [1, 1]);
    const job = await jobRow(jobId);
    assert.deepEqual([job.status, job.attempts, job.externalPostId], ["published", 1, "urn:li:share:7000000000000000301"]);
  });

  await check("publishing: one claim takes exactly one due post, the longest waiting, even with several due (the others stay queued for the next claim)", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-one-claim");
    const account = await realLinkedInAccount(owner, `member${runId}oc`);
    const jobIds = [(await scheduledJobIds(owner, draftId, [account]))[0]];
    for (const topic of ["Second due", "Third due"]) {
      jobIds.push((await scheduledJobIds(owner, await anotherApprovedDraft(owner, `${topic} ${runId}`), [account]))[0]);
    }
    for (const [index, jobId] of jobIds.entries()) {
      await db.update(publishJobs).set({ runAfter: sql`now() - make_interval(mins => ${30 - index})` }).where(eq(publishJobs.id, jobId));
    }
    const claim = await claimNextDuePublishJob({ onlyCompanyIds: [owner.companyId] });
    assert.ok(claim && claim.jobId === jobIds[0], "not the longest waiting post");
    const statuses = await Promise.all(jobIds.map(async (jobId) => (await jobRow(jobId)).status));
    assert.deepEqual(statuses, ["publishing", "queued", "queued"]);
    assert.equal(await sendClaimedJob(claim, throughFakePlatform(fakePlatform([linkedInPosted("urn:li:share:7000000000000000351")]).fetchFn)), "published");
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000352"), linkedInPosted("urn:li:share:7000000000000000353")]);
    const counts = await runDuePublishJobs(Date.now(), { ...throughFakePlatform(linkedIn.fetchFn), onlyCompanyIds: [owner.companyId] });
    assert.deepEqual([counts.published, linkedIn.requests.length], [2, 2]);
  });

  await check("publishing: a post still 'publishing' 10+ minutes after its claim was cut off while sending: it goes to a person (needs attention, 'interrupted') and is never sent again; one claimed a moment ago is left alone", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-stale");
    const account = await realLinkedInAccount(owner, `member${runId}st`);
    const freshDraft = await anotherApprovedDraft(owner, `Claimed a moment ago ${runId}`);
    const [staleJob] = await scheduledJobIds(owner, draftId, [account]);
    const [freshJob] = await scheduledJobIds(owner, freshDraft, [account]);
    for (const jobId of [staleJob, freshJob]) {
      await makeDue(jobId);
      assert.ok(await claimPublishJob(owner.companyId, jobId));
    }
    await db.update(publishJobs).set({ claimedAt: sql`now() - interval '11 minutes'` }).where(eq(publishJobs.id, staleJob));
    const options = { ...throughFakePlatform(noPlatform), onlyCompanyIds: [owner.companyId] };
    const counts = await runDuePublishJobs(Date.now(), options);
    assert.deepEqual([counts.interrupted, counts.published, counts.failed], [1, 0, 0]);
    const stale = await jobRow(staleJob);
    assert.deepEqual([stale.status, stale.lastError, stale.attempts], ["needs_attention", "interrupted", 1]);
    assert.equal((await jobRow(freshJob)).status, "publishing");
    assert.equal((await draftRow(draftId)).status, "failed");
    assert.deepEqual(await actionsOfJob(owner.companyId, staleJob), ["scheduled", "needs_attention"]);
    // Never claimed again, by any run.
    assert.equal(await runNow(owner, staleJob, options), undefined);
    assert.deepEqual(await runDuePublishJobs(Date.now(), options), { interrupted: 0, published: 0, failed: 0, needsAttention: 0, requeued: 0 });
    assert.equal((await jobRow(staleJob)).status, "needs_attention");
  });

  await check("publishing: a run that lost its post never writes over what came after: once its claim was handed to a person, and again once the post was tried again (its tries counted from 1 again) and claimed anew, its published, failed, needs-attention and back-in-the-queue writes change nothing, and it can't read the post to send it", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-late");
    const account = await realLinkedInAccount(owner, `member${runId}lt`);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    await makeDue(jobId);
    const lateClaim = await claimPublishJob(owner.companyId, jobId);
    assert.ok(lateClaim);
    await db.update(publishJobs).set({ claimedAt: sql`now() - interval '11 minutes'` }).where(eq(publishJobs.id, jobId));
    assert.equal((await runDuePublishJobs(Date.now(), { ...throughFakePlatform(noPlatform), onlyCompanyIds: [owner.companyId] })).interrupted, 1);
    assert.deepEqual(await writeEveryOutcome(lateClaim), [false, false, false, false]);
    assert.equal(await readJobForPublishing(lateClaim), null, "the old run could read the post to send it");
    const handedOver = await jobRow(jobId);
    assert.deepEqual([handedOver.status, handedOver.lastError], ["needs_attention", "interrupted"]);
    assert.deepEqual(await retryPublishJobForSession(owner, { jobId }, neverRun), { ok: true });
    const newClaim = await claimPublishJob(owner.companyId, jobId);
    assert.ok(newClaim && newClaim.attempt === lateClaim.attempt, "the tries didn't start again at 1");
    assert.equal(await readJobForPublishing(lateClaim), null, "the old run could read the post to send it");
    assert.deepEqual(await writeEveryOutcome(lateClaim), [false, false, false, false]);
    const held = await jobRow(jobId);
    assert.deepEqual([held.status, held.externalPostId, held.lastError, held.attempts], ["publishing", null, null, 1]);
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000392")]);
    assert.equal(await sendClaimedJob(newClaim, throughFakePlatform(linkedIn.fetchFn)), "published");
    assert.equal((await jobRow(jobId)).externalPostId, "urn:li:share:7000000000000000392");
    assert.deepEqual(await actionsOfJob(owner.companyId, jobId), ["scheduled", "needs_attention", "retried", "published"]);
  });

  await check("publishing: the platform is asked only while the run's claim is young enough for its longest answer to come before the claim counts as cut off; a run held up past that sends nothing and puts the post back in the queue (run_too_slow, its try given back), and the next run sends it", async () => {
    assert.equal(LATEST_SEND_START_MS + LONGEST_PUBLISH_MS, STALE_PUBLISHING_MINUTES * 60_000);
    assert.ok(LONGEST_PUBLISH_RUN_MS - LONGEST_PUBLISH_MS < LATEST_SEND_START_MS, "a run that isn't held up would reach the platform too late");
    const { owner, draftId } = await ownerWithApprovedDraft("pub-too-late");
    const account = await realLinkedInAccount(owner, `member${runId}tl`);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    await makeDue(jobId);
    const claim = await claimPublishJob(owner.companyId, jobId);
    assert.ok(claim);
    await db
      .update(publishJobs)
      .set({ claimedAt: sql`now() - make_interval(secs => ${LATEST_SEND_START_MS / 1000 + 5})` })
      .where(eq(publishJobs.id, jobId));
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000381")]);
    assert.equal(await sendClaimedJob(claim, throughFakePlatform(linkedIn.fetchFn)), "requeued");
    const putBack = await jobRow(jobId);
    assert.deepEqual([putBack.status, putBack.lastError, putBack.attempts, linkedIn.requests.length], ["queued", "run_too_slow", 0, 0]);
    assert.equal(await runNow(owner, jobId, throughFakePlatform(linkedIn.fetchFn)), "published");
    assert.deepEqual([(await jobRow(jobId)).attempts, linkedIn.requests.length], [1, 1]);
    assert.deepEqual(await actionsOfJob(owner.companyId, jobId), ["scheduled", "publish_delayed", "published"]);
  });
}
