// Publishing queue checks (step 41), scheduling: owners only, the version
// the page showed, connected accounts of the draft's own platform, a time
// within a minute ago and a year ahead; the same post never twice for one
// account (also two at once); another company's draft or account refused
// by Postgres and found by no service; a change of content cancels the
// waiting posts in the same transaction. Through the real services and /db.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { claimPublishJob } from "@/db/publish-runs";
import { scheduleDraftPosts } from "@/db/publish-scheduling";
import { cofounderActivity, publishJobs } from "@/db/schema";
import { cancelPublishJobForSession, markJobPublishedForSession, publishJobNowForSession, retryPublishJobForSession } from "@/services/publish-job-actions";
import { getQueuePageForSession } from "@/services/publishing-pages";
import { messageOf } from "./cofounder-helpers";
import { approveDraft, draftRow, editDraft, regenerateDraft } from "./content-studio-helpers";
import { addTeammate, assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { attachToDraft, imagePostDraft } from "./media-draft-checks";
import { collectingAfter, PNG, uploadedAssetId } from "./media-helpers";
import {
  activityRows,
  anotherApprovedDraft,
  approvedDraftOf,
  inMinutes,
  jobRow,
  jobRowsOfDraft,
  linkedInPosted,
  makeDue,
  ownerWithApprovedDraft,
  realLinkedInAccount,
  schedule,
  scheduledJobIds,
  standInAccount,
  throughFakePlatform,
  trackStandInJob,
} from "./publishing-helpers";
import { fakePlatform } from "./social-helpers";

export async function runPublishingScheduleChecks() {
  await check("publishing: scheduling needs an owner (a member is refused by the service and by /db), the version the page showed, and connected accounts of the draft's own platform; a time over a minute ago or over a year ahead is refused; a refusal saves nothing", async () => {
    const ownerUser = await signUpTestOwner("pub-schedule");
    const owner = sessionFor(ownerUser);
    const draftId = await approvedDraftOf(owner);
    const member = sessionFor(await addTeammate(ownerUser, "pub-schedule-member", "member"));
    const account = await standInAccount(owner);
    const xAccount = await standInAccount(owner, "x");
    assert.match(messageOf((await schedule(member, draftId, [account])).result), /Only owners schedule/);
    const asMember = await scheduleDraftPosts(member.companyId, member.userId, { draftId, version: 1, connectionIds: [account], scheduledFor: null, withoutApproval: false });
    assert.deepEqual(asMember, { outcome: "not-allowed" });
    const stale = await scheduleDraftPosts(owner.companyId, owner.userId, { draftId, version: 2, connectionIds: [account], scheduledFor: null, withoutApproval: false });
    assert.deepEqual(stale, { outcome: "stale" });
    assert.match(messageOf((await schedule(owner, draftId, [xAccount])).result), /isn't connected any more \(or isn't on this draft's platform\)/);
    assert.match(JSON.stringify((await schedule(owner, draftId, [account], new Date(Date.now() - 2 * 60_000))).result), /That time has passed/);
    assert.match(JSON.stringify((await schedule(owner, draftId, [account], new Date(Date.now() + 366 * 24 * 3_600_000))).result), /within the next year/);
    assert.match(JSON.stringify((await schedule(owner, draftId, [])).result), /Pick at least one account/);
    assert.equal((await jobRowsOfDraft(draftId)).length, 0, "a refused schedule saved a post");
    // Half a minute ago is still taken, and as it is due already it goes out after the answer.
    const justNow = await schedule(owner, draftId, [account], new Date(Date.now() - 30_000));
    assert.deepEqual([justNow.result, justNow.after.tasks.length], [{ ok: true }, 1]);
    assert.deepEqual((await justNow.after.settle())[0], ["published"]);
    await trackStandInJob((await jobRowsOfDraft(draftId))[0].id);
  });

  await check("publishing: the same post can't be queued twice for one account: a second schedule is refused, Postgres refuses a second live post (also two schedules at once: one wins), and a canceled or failed one leaves room for a new one", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-twice");
    const account = await realLinkedInAccount(owner, `member${runId}tw`);
    const [first] = await scheduledJobIds(owner, draftId, [account]);
    assert.match(messageOf((await schedule(owner, draftId, [account], inMinutes(90))).result), /already scheduled, published or waiting for a check/);
    const row = await jobRow(first);
    const copy = { ...row, id: crypto.randomUUID() };
    await assertRefusedByConstraint(db.insert(publishJobs).values(copy), "publish_jobs_one_live_per_draft_account");
    const raced = await anotherApprovedDraft(owner, `Scheduled twice at once ${runId}`);
    const both = await Promise.all([schedule(owner, raced, [account], inMinutes(30)), schedule(owner, raced, [account], inMinutes(30))]);
    assert.deepEqual(both.map((attempt) => attempt.result.ok).sort(), [false, true]);
    assert.equal((await jobRowsOfDraft(raced)).length, 1);
    assert.deepEqual(await cancelPublishJobForSession(owner, { jobId: first }), { ok: true });
    assert.deepEqual((await schedule(owner, draftId, [account], inMinutes(120))).result, { ok: true });
    assert.deepEqual((await jobRowsOfDraft(draftId)).map((job) => job.status), ["canceled", "queued"]);
  });

  await check("publishing: Postgres refuses a post pointing at another company's draft, account or person; another company's owner can't schedule, cancel, send, retry or mark the company's posts (services and /db) and finds none of them; an owner can't send a draft to another company's account", async () => {
    const a = await ownerWithApprovedDraft("pub-tenant-a");
    const b = await ownerWithApprovedDraft("pub-tenant-b");
    const accountA = await realLinkedInAccount(a.owner, `member${runId}ta`);
    const accountB = await realLinkedInAccount(b.owner, `member${runId}tb`);
    const [jobA] = await scheduledJobIds(a.owner, a.draftId, [accountA]);
    const base = { status: "queued" as const, approvalMode: "owner" as const, approvedVersion: 1, scheduledFor: new Date(), runAfter: new Date() };
    await assertRefusedByConstraint(
      db.insert(publishJobs).values({ ...base, companyId: b.owner.companyId, draftId: a.draftId, connectionId: accountB, createdByUserId: b.owner.userId }),
      "publish_jobs_draft_in_same_company_fk",
    );
    await assertRefusedByConstraint(
      db.insert(publishJobs).values({ ...base, companyId: a.owner.companyId, draftId: a.draftId, connectionId: accountB, createdByUserId: a.owner.userId }),
      "publish_jobs_connection_in_same_company_fk",
    );
    // Canceled: A's draft already has a live post on that account.
    await assertRefusedByConstraint(
      db.insert(publishJobs).values({ ...base, status: "canceled", companyId: a.owner.companyId, draftId: a.draftId, connectionId: accountA, createdByUserId: b.owner.userId }),
      "publish_jobs_creator_in_same_company_fk",
    );
    await assertRefusedByConstraint(
      db.insert(cofounderActivity).values({ companyId: b.owner.companyId, action: "scheduled", actorUserId: b.owner.userId, draftId: a.draftId }),
      "cofounder_activity_draft_in_same_company_fk",
    );
    const asB = await scheduleDraftPosts(b.owner.companyId, b.owner.userId, { draftId: a.draftId, version: 1, connectionIds: [accountA], scheduledFor: null, withoutApproval: false });
    assert.deepEqual(asB, { outcome: "not-found" });
    assert.match(messageOf((await schedule(b.owner, a.draftId, [accountB])).result), /couldn't find that draft/);
    // A's own draft to B's account: not one of A's accounts, refused before anything is saved.
    assert.match(messageOf((await schedule(a.owner, a.draftId, [accountB], inMinutes(90))).result), /isn't connected any more/);
    assert.deepEqual((await jobRowsOfDraft(a.draftId)).map((job) => job.connectionId), [accountA]);
    const after = collectingAfter();
    for (const result of [
      await cancelPublishJobForSession(b.owner, { jobId: jobA }),
      await publishJobNowForSession(b.owner, { jobId: jobA }, after.run),
      await retryPublishJobForSession(b.owner, { jobId: jobA }, after.run),
      await markJobPublishedForSession(b.owner, { jobId: jobA, postUrl: "" }),
    ]) {
      assert.match(messageOf(result), /couldn't find that (post|draft or post)/);
    }
    assert.equal(after.tasks.length, 0);
    await makeDue(jobA);
    assert.equal(await claimPublishJob(b.owner.companyId, jobA), undefined, "B's run claimed A's post");
    assert.deepEqual([(await jobRow(jobA)).status, (await jobRow(jobA)).canceledByUserId], ["queued", null]);
    const queueB = await getQueuePageForSession(b.owner);
    const everyJobOfB = [...queueB.waiting, ...queueB.needsAttention, ...queueB.failed, ...queueB.published, ...queueB.canceled];
    assert.ok(!everyJobOfB.some((job) => job.id === jobA) && !queueB.activity.some((entry) => entry.jobId === jobA), "B sees A's post");
  });

  await check("publishing: editing, regenerating or attaching media to a scheduled draft cancels its waiting posts in the same transaction (draft_changed_after_approval, then canceled with draft_changed); a post being sent at that moment is left alone", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-change");
    const standIn = await standInAccount(owner);
    const real = await realLinkedInAccount(owner, `member${runId}ch`);
    const [waiting, sending] = await scheduledJobIds(owner, draftId, [standIn, real]);
    await db.update(publishJobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(publishJobs.id, sending));
    assert.ok(await claimPublishJob(owner.companyId, sending), "the post going out was not claimed");
    assert.deepEqual(await editDraft(owner, draftId, { body: "Changed while scheduled." }), { ok: true });
    assert.deepEqual([(await jobRow(waiting)).status, (await jobRow(waiting)).canceledByUserId, (await jobRow(sending)).status], ["canceled", owner.userId, "publishing"]);
    const draft = await draftRow(draftId);
    assert.deepEqual([draft.status, draft.approvedByUserId], ["draft", null]);
    const entries = (await activityRows(owner.companyId)).filter((entry) => entry.draftId === draftId).map((entry) => `${entry.action}:${entry.code ?? ""}`);
    assert.deepEqual(entries.slice(-2), ["draft_changed_after_approval:", "canceled:draft_changed"]);
    // The AI's new text does the same.
    const regenerated = await anotherApprovedDraft(owner, `Regenerated while scheduled ${runId}`);
    const [byRegeneration] = await scheduledJobIds(owner, regenerated, [standIn]);
    assert.deepEqual((await regenerateDraft(owner, regenerated)).result, { ok: true });
    assert.equal((await jobRow(byRegeneration)).status, "canceled");
    // And a new image.
    const imageDraft = await imagePostDraft(owner);
    assert.deepEqual(await attachToDraft(owner, imageDraft, await uploadedAssetId(owner, PNG, "first.png")), { ok: true });
    assert.deepEqual(await approveDraft(owner, imageDraft, true), { ok: true });
    const [byImage] = await scheduledJobIds(owner, imageDraft, [standIn]);
    assert.deepEqual(await attachToDraft(owner, imageDraft, await uploadedAssetId(owner, PNG, "second.png")), { ok: true });
    assert.deepEqual([(await jobRow(byImage)).status, (await draftRow(imageDraft)).status], ["canceled", "draft"]);
  });

  await check("publishing: Cancel takes a waiting post out (owners only; one that went out can't be); Publish now sends a waiting post at once; Retry checks like a new schedule (a draft changed since needs approving again, then its new version is sent)", async () => {
    const ownerUser = await signUpTestOwner("pub-actions");
    const owner = sessionFor(ownerUser);
    const draftId = await approvedDraftOf(owner);
    const member = sessionFor(await addTeammate(ownerUser, "pub-actions-member", "member"));
    const account = await realLinkedInAccount(owner, `member${runId}ac`);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    assert.match(messageOf(await cancelPublishJobForSession(member, { jobId })), /Only owners/);
    assert.deepEqual(await cancelPublishJobForSession(owner, { jobId }), { ok: true });
    assert.deepEqual([(await jobRow(jobId)).status, (await draftRow(draftId)).status], ["canceled", "approved"]);
    const [laterJob] = await scheduledJobIds(owner, draftId, [account], inMinutes(600));
    const after = collectingAfter();
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000801")]);
    assert.deepEqual(await publishJobNowForSession(owner, { jobId: laterJob }, after.run, throughFakePlatform(linkedIn.fetchFn)), { ok: true });
    assert.deepEqual((await after.settle())[0], ["published"]);
    assert.ok((await jobRow(laterJob)).scheduledFor.getTime() <= Date.now(), "Publish now didn't bring its time forward");
    assert.match(messageOf(await cancelPublishJobForSession(owner, { jobId: laterJob })), /no longer waiting/);
    // A post that failed, then its draft changed: approved again, Retry sends the new version.
    const failing = await anotherApprovedDraft(owner, `Failed then changed ${runId}`);
    const otherAccount = await realLinkedInAccount(owner, `member${runId}ac2`);
    const [failedJob] = await scheduledJobIds(owner, failing, [otherAccount]);
    await db.update(publishJobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(publishJobs.id, failedJob));
    const refused = await publishJobNowForSession(owner, { jobId: failedJob }, after.run, throughFakePlatform(fakePlatform([new Response(null, { status: 400 })]).fetchFn));
    assert.deepEqual(refused, { ok: true });
    await after.settle();
    assert.deepEqual([(await jobRow(failedJob)).status, (await jobRow(failedJob)).lastError], ["failed", "invalid_request"]);
    assert.deepEqual(await editDraft(owner, failing, { body: "Fixed after it failed." }), { ok: true });
    assert.match(messageOf(await retryPublishJobForSession(owner, { jobId: failedJob }, after.run)), /An owner approves this version/);
    assert.deepEqual(await approveDraft(owner, failing, true), { ok: true });
    const retried = await retryPublishJobForSession(owner, { jobId: failedJob }, after.run, throughFakePlatform(fakePlatform([linkedInPosted("urn:li:share:7000000000000000802")]).fetchFn));
    assert.deepEqual(retried, { ok: true });
    assert.deepEqual((await after.settle())[0], ["published"]);
    assert.deepEqual([(await jobRow(failedJob)).status, (await jobRow(failedJob)).approvedVersion], ["published", (await draftRow(failing)).version]);
  });
}
