// Publishing queue checks (step 41), what comes back from a platform: a
// 429 puts the post back with its wait and gives up after 5 tries; an
// unclear answer goes to a person, who marks it published (its address on
// the platform's own hosts only) or not, and may retry; a token about to
// run out is renewed first, a refused renewal or token marks the account
// for reconnecting; posts survive a restart (rows only); the company's
// daily limit holds one back; production refuses the stand-in. Fake
// platforms only.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { publishJobs, socialConnections } from "@/db/schema";
import { MAX_PUBLISH_ATTEMPTS } from "@/lib/publishing/limits";
import { markJobNotPublishedForSession, markJobPublishedForSession, retryPublishJobForSession } from "@/services/publish-job-actions";
import { runDuePublishJobs } from "@/services/publish-runs";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { messageOf } from "./cofounder-helpers";
import { approveDraft, draftAnswer, draftRow, generatedDraftId, LINKEDIN_POST } from "./content-studio-helpers";
import { check, runId } from "./helpers";
import { collectingAfter } from "./media-helpers";
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
  standInAccount,
  throughFakePlatform,
} from "./publishing-helpers";
import { connectFully, connectionRows, fakePlatform, json, noPlatform, ownXAccountId, xConnects } from "./social-helpers";

const slowDown = (retryAfter?: string) => new Response(null, { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });

// Seconds from now until the job's next try.
async function secondsUntilNextTry(jobId: string): Promise<number> {
  return ((await jobRow(jobId)).runAfter.getTime() - Date.now()) / 1000;
}

export async function runPublishingOutcomeChecks() {
  await check("publishing: a platform's 429 puts the post back in the queue for the wait it asked (or 1, 2, 4 minutes), each run a try, and the fifth 429 fails it (rate_limited)", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-429");
    const account = await realLinkedInAccount(owner, `member${runId}rl`);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    const linkedIn = fakePlatform([slowDown("120"), slowDown(), slowDown(), slowDown(), slowDown()]);
    const options = throughFakePlatform(linkedIn.fetchFn);
    const waits: number[] = [];
    for (let attempt = 1; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
      await makeDue(jobId);
      assert.equal(await runNow(owner, jobId, options), "requeued", `try ${attempt}`);
      const job = await jobRow(jobId);
      assert.deepEqual([job.status, job.attempts, job.lastError], ["queued", attempt, "rate_limited"]);
      waits.push(Math.round(await secondsUntilNextTry(jobId)));
    }
    // retry-after: 120, then 2, 4, 8 minutes from the second try on.
    assert.ok(Math.abs(waits[0] - 120) <= 3 && Math.abs(waits[1] - 120) <= 3 && Math.abs(waits[2] - 240) <= 3 && Math.abs(waits[3] - 480) <= 3, `waits ${waits}`);
    await makeDue(jobId);
    assert.equal(await runNow(owner, jobId, options), "failed");
    const job = await jobRow(jobId);
    assert.deepEqual([job.status, job.attempts, job.lastError, linkedIn.requests.length], ["failed", MAX_PUBLISH_ATTEMPTS, "rate_limited", MAX_PUBLISH_ATTEMPTS]);
    assert.deepEqual(await actionsOfJob(owner.companyId, jobId), ["scheduled", "publish_delayed", "publish_delayed", "publish_delayed", "publish_delayed", "publish_failed"]);
  });

  await check("publishing: an unclear answer (a 500, no answer) needs a person and is never tried again by itself; 'Mark as published' keeps only an address on the platform's own hosts, 'Mark as not published' fails it, and Retry then sends it", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-unclear");
    const account = await realLinkedInAccount(owner, `member${runId}uc`);
    const otherDraft = await anotherApprovedDraft(owner, `No answer ${runId}`);
    const [first] = await scheduledJobIds(owner, draftId, [account]);
    const [second] = await scheduledJobIds(owner, otherDraft, [account]);
    await makeDue(first);
    await makeDue(second);
    const linkedIn = fakePlatform([new Response(null, { status: 500 })]);
    assert.equal(await runNow(owner, first, throughFakePlatform(linkedIn.fetchFn)), "needs_attention");
    assert.equal(await runNow(owner, second, throughFakePlatform(noPlatform)), "needs_attention");
    assert.deepEqual([(await jobRow(first)).lastError, (await jobRow(second)).lastError], ["server_error", "network_error"]);
    assert.equal(await runNow(owner, first, throughFakePlatform(noPlatform)), undefined, "a post needing attention was claimed again");
    const anotherSite = await markJobPublishedForSession(owner, { jobId: first, postUrl: "https://linkedin.example.test/feed/update/1" });
    assert.match(JSON.stringify(anotherSite), /Paste the post's address on LinkedIn/);
    const address = "https://www.linkedin.com/feed/update/urn:li:share:7000000000000000401/";
    assert.deepEqual(await markJobPublishedForSession(owner, { jobId: first, postUrl: address }), { ok: true });
    const marked = await jobRow(first);
    assert.deepEqual([marked.status, marked.externalUrl, marked.lastError, marked.externalPostId], ["published", address, "server_error", null]);
    assert.equal((await draftRow(draftId)).status, "published");
    assert.deepEqual(await markJobNotPublishedForSession(owner, { jobId: second }), { ok: true });
    assert.deepEqual([(await jobRow(second)).status, (await draftRow(otherDraft)).status], ["failed", "failed"]);
    const after = collectingAfter();
    const sent = fakePlatform([linkedInPosted("urn:li:share:7000000000000000402")]);
    assert.deepEqual(await retryPublishJobForSession(owner, { jobId: second }, after.run, throughFakePlatform(sent.fetchFn)), { ok: true });
    assert.deepEqual([(await jobRow(second)).status, (await jobRow(second)).attempts], ["queued", 0]);
    assert.deepEqual((await after.settle())[0], ["published"]);
    assert.deepEqual([(await jobRow(second)).status, (await draftRow(otherDraft)).status], ["published", "published"]);
    assert.deepEqual(await actionsOfJob(owner.companyId, second), ["scheduled", "needs_attention", "marked_not_published", "retried", "published"]);
    assert.match(messageOf(await markJobPublishedForSession(owner, { jobId: second, postUrl: "" })), /no longer needs attention/);
  });

  await check("publishing: an X token about to run out is renewed before the post (the new token sent); a refused renewal marks the account for reconnecting and fails the post (reauthorization_needed); LinkedIn refusing the token (401) does the same (token_rejected)", async () => {
    const { owner } = await ownerWithApprovedDraft("pub-token");
    await connectFully(owner, "x", xConnects(ownXAccountId()));
    const xAccount = (await connectionRows(owner.companyId)).find((row) => row.platform === "x");
    assert.ok(xAccount);
    const xRequest = { platform: "x", format: "post", topic: `Renewed first ${runId}`, pillar: "", campaign: "" };
    const xDraft = await generatedDraftId(owner, xRequest);
    assert.deepEqual(await approveDraft(owner, xDraft, true), { ok: true });
    const [renewedJob] = await scheduledJobIds(owner, xDraft, [xAccount.id]);
    await db.update(socialConnections).set({ accessExpiresAt: sql`now() + interval '3 minutes'` }).where(eq(socialConnections.id, xAccount.id));
    await makeDue(renewedJob);
    const x = fakePlatform([json({ token_type: "bearer", expires_in: 7200, access_token: `x-new-${runId}`, refresh_token: `x-refresh-new-${runId}` }), json({ data: { id: "1790000000000000501" } }, 201)]);
    assert.equal(await runNow(owner, renewedJob, throughFakePlatform(x.fetchFn)), "published");
    assert.deepEqual([x.requests[0].url, x.requests[1].url, x.requests[1].headers.authorization], ["https://api.x.com/2/oauth2/token", "https://api.x.com/2/tweets", `Bearer x-new-${runId}`]);
    const refusedDraft = await generatedDraftId(owner, { ...xRequest, topic: `Renewal refused ${runId}` });
    assert.deepEqual(await approveDraft(owner, refusedDraft, true), { ok: true });
    const [refusedJob] = await scheduledJobIds(owner, refusedDraft, [xAccount.id]);
    await db.update(socialConnections).set({ accessExpiresAt: sql`now() + interval '1 minute'` }).where(eq(socialConnections.id, xAccount.id));
    await makeDue(refusedJob);
    assert.equal(await runNow(owner, refusedJob, throughFakePlatform(fakePlatform([json({ error: "invalid_grant" }, 400)]).fetchFn)), "failed");
    assert.equal((await jobRow(refusedJob)).lastError, "reauthorization_needed");
    const xAfter = (await connectionRows(owner.companyId)).find((row) => row.id === xAccount.id);
    assert.deepEqual([xAfter?.status, xAfter?.lastError], ["needs_reauth", "refresh_refused"]);
    const linkedInAccount = await realLinkedInAccount(owner, `member${runId}tr`);
    const linkedInDraft = await anotherApprovedDraft(owner, `Token refused ${runId}`);
    const [rejectedJob] = await scheduledJobIds(owner, linkedInDraft, [linkedInAccount]);
    await makeDue(rejectedJob);
    assert.equal(await runNow(owner, rejectedJob, throughFakePlatform(fakePlatform([new Response(null, { status: 401 })]).fetchFn)), "failed");
    assert.equal((await jobRow(rejectedJob)).lastError, "token_rejected");
    const linkedInAfter = (await connectionRows(owner.companyId)).find((row) => row.id === linkedInAccount);
    assert.deepEqual([linkedInAfter?.status, linkedInAfter?.lastError], ["needs_reauth", "token_rejected"]);
  });

  await check("publishing: posts survive a restart (rows only): with the run after the answer lost, a fresh runner sends the due ones, the longest waiting first, and leaves one not due yet", async () => {
    const { owner } = await ownerWithApprovedDraft("pub-restart");
    const account = await realLinkedInAccount(owner, `member${runId}rs`);
    const drafts: string[] = [];
    for (const body of ["Due ten minutes ago.", "Due a minute ago.", "Due in an hour."]) {
      const draftId = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `${body} ${runId}` }, draftAnswer({ body }));
      assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
      drafts.push(draftId);
    }
    const jobs = [];
    for (const draftId of drafts) {
      jobs.push((await scheduledJobIds(owner, draftId, [account]))[0]);
    }
    await db.update(publishJobs).set({ runAfter: sql`now() - interval '10 minutes'` }).where(eq(publishJobs.id, jobs[0]));
    await db.update(publishJobs).set({ runAfter: sql`now() - interval '1 minute'` }).where(eq(publishJobs.id, jobs[1]));
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000601"), linkedInPosted("urn:li:share:7000000000000000602")]);
    const counts = await runDuePublishJobs(Date.now(), { ...throughFakePlatform(linkedIn.fetchFn), onlyCompanyIds: [owner.companyId] });
    assert.equal(counts.published, 2);
    const sentTexts = linkedIn.requests.map((request) => JSON.parse(String(request.body)).commentary as string);
    assert.ok(sentTexts[0].startsWith("Due ten minutes ago") && sentTexts[1].startsWith("Due a minute ago"), JSON.stringify(sentTexts));
    assert.deepEqual([(await jobRow(jobs[0])).status, (await jobRow(jobs[1])).status, (await jobRow(jobs[2])).status], ["published", "published", "queued"]);
  });

  await check("publishing: past the company's posts for the day a post is held back (queued, daily_limit, its tries untouched, tried an hour later) and the platform isn't asked; another company still posts", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-daily");
    const other = await ownerWithApprovedDraft("pub-daily-other");
    const account = await realLinkedInAccount(owner, `member${runId}dl`);
    const otherAccount = await realLinkedInAccount(other.owner, `member${runId}dlo`);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    const [otherJob] = await scheduledJobIds(other.owner, other.draftId, [otherAccount]);
    for (let attempt = 0; attempt < RATE_LIMITS.publishAttemptsPerCompany.maxAttempts; attempt++) {
      await isOverRateLimit("publish-attempts", owner.companyId, RATE_LIMITS.publishAttemptsPerCompany);
    }
    await makeDue(jobId);
    assert.equal(await runNow(owner, jobId, throughFakePlatform(noPlatform)), "held_back");
    const held = await jobRow(jobId);
    assert.deepEqual([held.status, held.lastError, held.attempts], ["queued", "daily_limit", 0]);
    assert.ok(Math.abs((await secondsUntilNextTry(jobId)) - 3600) <= 5, "not held back for an hour");
    await makeDue(otherJob);
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000701")]);
    assert.equal(await runNow(other.owner, otherJob, throughFakePlatform(linkedIn.fetchFn)), "published");
  });

  await check("publishing: production refuses a stand-in account's post (stand_in_in_production), and a platform ansa hasn't set up publishes nothing (not_set_up)", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-production");
    const standIn = await standInAccount(owner);
    const [standInJob] = await scheduledJobIds(owner, draftId, [standIn]);
    await makeDue(standInJob);
    const production = { social: { nodeEnv: "production", modeOf: () => ({ kind: "not-set-up" as const }), fetchFn: noPlatform } };
    assert.equal(await runNow(owner, standInJob, production), "failed");
    assert.equal((await jobRow(standInJob)).lastError, "stand_in_in_production");
    const real = await realLinkedInAccount(owner, `member${runId}ns`);
    const realDraft = await anotherApprovedDraft(owner, `Not set up ${runId}`);
    const [realJob] = await scheduledJobIds(owner, realDraft, [real]);
    await makeDue(realJob);
    assert.equal(await runNow(owner, realJob, production), "failed");
    assert.equal((await jobRow(realJob)).lastError, "not_set_up");
  });
}
