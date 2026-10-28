// Publishing queue checks (step 41), the runs: an approved draft scheduled
// for now goes out through the stand-in; permission is decided when a post
// RUNS (a draft changed, rejected or archived after its post was claimed,
// an approver demoted or removed, a rule switched off, a word to avoid
// confirmed since: each fails it with its code, nothing sent). Claims:
// publishing-claim-checks.ts. Through the real services and /db; fake
// platforms only (noPlatform fails any request).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { claimPublishJob } from "@/db/publish-runs";
import { autopublishRules } from "@/db/schema";
import { composePublishedText } from "@/lib/content-rules";
import { createAutopublishRuleForSession, setAutopublishRuleForSession } from "@/services/autopublish-rules";
import { countContentDraftsForSession, getContentDraftPageForSession, listContentDraftsForSession } from "@/services/content-drafts";
import { archiveDraftForSession, rejectDraftForSession } from "@/services/content-review";
import { getDraftPublishingForSession } from "@/services/draft-publishing";
import { sendClaimedJob } from "@/services/publish-attempt";
import { retryPublishJobForSession } from "@/services/publish-job-actions";
import { changeTeammateRoleForSession, removeTeammateForSession } from "@/services/team";
import { messageOf, typeFact } from "./cofounder-helpers";
import { approveDraft, draftRow, editDraft, generatedDraftId, LINKEDIN_POST, makeReadyForDrafts } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { neverRun } from "./media-helpers";
import {
  actionsOfJob,
  anotherApprovedDraft,
  cleanDraftAnswer,
  inMinutes,
  jobRow,
  jobRowsOfDraft,
  linkedInPosted,
  makeDue,
  ownerWithApprovedDraft,
  realLinkedInAccount,
  runNow,
  schedule,
  scheduledJobIds,
  standInAccount,
  throughFakePlatform,
  trackStandInJob,
} from "./publishing-helpers";
import { fakePlatform, noPlatform } from "./social-helpers";

export async function runPublishingRunChecks() {
  await check("publishing: an approved draft scheduled for now goes out right after the answer: the stand-in writes it to .dev-social/<platform>/, the post is published with its dev id, the draft is published, and the log says scheduled, then published", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-now");
    const account = await standInAccount(owner);
    const { result, after } = await schedule(owner, draftId, [account]);
    assert.deepEqual(result, { ok: true });
    const [queued] = await jobRowsOfDraft(draftId);
    assert.deepEqual([queued.status, queued.approvalMode, queued.approvedVersion, queued.attempts, queued.autopublishRuleId], ["queued", "owner", 1, 0, null]);
    assert.equal((await draftRow(draftId)).status, "scheduled");
    assert.equal(after.tasks.length, 1, "nothing was handed to the run after the answer");
    const [outcomes] = await after.settle();
    assert.deepEqual(outcomes, ["published"]);
    const job = await jobRow(queued.id);
    const fileName = await trackStandInJob(job.id);
    assert.ok(fileName, "the stand-in wrote no file");
    const written = JSON.parse(await readFile(path.join(process.cwd(), ".dev-social", "linkedin", fileName), "utf8"));
    const draft = await draftRow(draftId);
    assert.deepEqual([written.platform, written.text, written.media], ["linkedin", composePublishedText(draft), null]);
    assert.deepEqual([job.status, job.attempts, job.externalUrl, job.lastError], ["published", 1, null, null]);
    assert.match(job.externalPostId ?? "", /^dev-[0-9a-f-]{36}$/);
    assert.ok(job.publishedAt && job.claimedAt, "no time of publishing or claim");
    assert.equal(draft.status, "published");
    assert.deepEqual(await actionsOfJob(owner.companyId, job.id), ["scheduled", "published"]);
    // The studio lists it under Published.
    assert.equal((await countContentDraftsForSession(owner, "all")).published, 1);
    assert.deepEqual((await listContentDraftsForSession(owner, 1, { status: "published", platform: "linkedin" })).map((listed) => listed.id), [draftId]);
  });

  await check("publishing: drafts that aren't approved are refused when scheduled; one changed, rejected or archived after its post was claimed fails it when it runs (draft_changed, draft_rejected, draft_archived) and nothing is sent", async () => {
    const owner = sessionFor(await signUpTestOwner("pub-unapproved"));
    await makeReadyForDrafts(owner);
    const account = await realLinkedInAccount(owner, `member${runId}un`);
    const unapproved = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Not approved ${runId}` });
    assert.match(messageOf((await schedule(owner, unapproved, [account])).result), /An owner approves this version/);
    assert.equal((await jobRowsOfDraft(unapproved)).length, 0);
    const changes = [
      { change: "edit", code: "draft_changed" },
      { change: "reject", code: "draft_rejected" },
      { change: "archive", code: "draft_archived" },
    ];
    for (const { change, code } of changes) {
      const draftId = await anotherApprovedDraft(owner, `Changed by ${change} ${runId}`);
      const [jobId] = await scheduledJobIds(owner, draftId, [account]);
      await makeDue(jobId);
      // The run claimed it; the change lands before it sends.
      const claim = await claimPublishJob(owner.companyId, jobId);
      assert.ok(claim, `${change}: not claimed`);
      const version = String((await draftRow(draftId)).version);
      if (change === "edit") {
        assert.deepEqual(await editDraft(owner, draftId, { body: "Changed after it was approved." }), { ok: true });
      } else if (change === "reject") {
        assert.deepEqual(await rejectDraftForSession(owner, { draftId, version, note: null }), { ok: true });
      } else {
        assert.deepEqual(await archiveDraftForSession(owner, { draftId }), { ok: true });
      }
      assert.equal(await sendClaimedJob(claim, throughFakePlatform(noPlatform)), "failed", change);
      const job = await jobRow(jobId);
      assert.deepEqual([job.status, job.lastError, job.externalPostId], ["failed", code, null], change);
    }
  });

  await check("publishing: an approver made a member, or removed, after the post was scheduled: it fails when it runs (approver_not_owner) and nothing is sent; the draft can't be scheduled again until another owner approves it, which the draft's page then offers, and its post goes out: the draft is then published, and the failed post it replaced on that account offers no Retry", async () => {
    const ownerUser = await signUpTestOwner("pub-approver");
    const owner = sessionFor(ownerUser);
    await makeReadyForDrafts(owner);
    const account = await realLinkedInAccount(owner, `member${runId}ap`);
    for (const change of ["demote", "remove"]) {
      const approver = sessionFor(await addTeammate(ownerUser, `pub-approver-${change}`, "owner"));
      const draftId = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Approved before ${change} ${runId}` });
      assert.deepEqual(await approveDraft(approver, draftId, true), { ok: true });
      const [jobId] = await scheduledJobIds(owner, draftId, [account]);
      const changed =
        change === "demote"
          ? await changeTeammateRoleForSession(owner, { userId: approver.userId, role: "member" })
          : await removeTeammateForSession(owner, { userId: approver.userId });
      assert.deepEqual(changed, { ok: true });
      await makeDue(jobId);
      assert.equal(await runNow(owner, jobId, throughFakePlatform(noPlatform)), "failed", change);
      assert.deepEqual([(await jobRow(jobId)).status, (await jobRow(jobId)).lastError], ["failed", "approver_not_owner"], change);
      const again = await schedule(owner, draftId, [account], inMinutes(30));
      assert.match(messageOf(again.result), /no longer an owner of the company: an owner approves it again first/, change);
      assert.equal((await getContentDraftPageForSession(owner, draftId))?.approval?.byActiveOwner, false, change);
      assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true }, change);
      assert.deepEqual([(await draftRow(draftId)).approvedByUserId, (await draftRow(draftId)).status], [owner.userId, "failed"], change);
      const linkedIn = fakePlatform([linkedInPosted(`urn:li:share:70000000000000002${change === "demote" ? "11" : "12"}`)]);
      const sent = await schedule(owner, draftId, [account], "now", { run: throughFakePlatform(linkedIn.fetchFn) });
      assert.deepEqual([sent.result, (await sent.after.settle())[0]], [{ ok: true }, ["published"]], change);
      assert.equal((await draftRow(draftId)).status, "published", `${change}: the replaced failure still decides the draft`);
      const replaced = (await getDraftPublishingForSession(owner, await draftRow(draftId))).jobs.find((job) => job.id === jobId);
      assert.deepEqual([replaced?.status, replaced?.scheduledAgain], ["failed", true], change);
      assert.match(messageOf(await retryPublishJobForSession(owner, { jobId }, neverRun)), /already scheduled, published or waiting for a check/, change);
    }
  });

  await check("publishing: a word to avoid confirmed after the approval stops the post: scheduling the draft is refused, and its post already waiting fails when it runs (draft_has_problems); nothing is sent", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("pub-avoid");
    const account = await realLinkedInAccount(owner, `member${runId}av`);
    const standIn = await standInAccount(owner);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    await typeFact(owner, "words_to_avoid", "Sourdough, guaranteed");
    assert.match(messageOf((await schedule(owner, draftId, [standIn], inMinutes(30))).result), /uses a word to avoid/);
    await makeDue(jobId);
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000171")]);
    assert.equal(await runNow(owner, jobId, throughFakePlatform(linkedIn.fetchFn)), "failed");
    assert.deepEqual([(await jobRow(jobId)).lastError, linkedIn.requests.length, (await jobRowsOfDraft(draftId)).length], ["draft_has_problems", 0, 1]);
  });

  await check("publishing: a post scheduled under an auto-publish rule fails when it runs once the rule is switched off (rule_disabled), nothing sent; with the rule on it goes out", async () => {
    const owner = sessionFor(await signUpTestOwner("pub-rule-off"));
    await makeReadyForDrafts(owner);
    const account = await realLinkedInAccount(owner, `member${runId}ro`);
    assert.deepEqual(await createAutopublishRuleForSession(owner, { platform: "linkedin", pillar: "" }), { ok: true });
    const [rule] = await db.select({ id: autopublishRules.id }).from(autopublishRules).where(eq(autopublishRules.companyId, owner.companyId));
    assert.deepEqual(await setAutopublishRuleForSession(owner, { ruleId: rule.id }, true), { ok: true });
    const offDraft = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Rule switched off ${runId}` }, cleanDraftAnswer());
    const { result } = await schedule(owner, offDraft, [account], inMinutes(60), { withoutApproval: true });
    assert.deepEqual(result, { ok: true });
    const [offJob] = await jobRowsOfDraft(offDraft);
    assert.deepEqual([offJob.approvalMode, offJob.autopublishRuleId], ["auto_rule", rule.id]);
    assert.deepEqual(await setAutopublishRuleForSession(owner, { ruleId: rule.id }, false), { ok: true });
    await makeDue(offJob.id);
    assert.equal(await runNow(owner, offJob.id, throughFakePlatform(noPlatform)), "failed");
    assert.equal((await jobRow(offJob.id)).lastError, "rule_disabled");
    assert.deepEqual(await setAutopublishRuleForSession(owner, { ruleId: rule.id }, true), { ok: true });
    const onDraft = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Rule switched on ${runId}` }, cleanDraftAnswer());
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000201")]);
    const sent = await schedule(owner, onDraft, [account], "now", { withoutApproval: true, run: throughFakePlatform(linkedIn.fetchFn) });
    assert.deepEqual(sent.result, { ok: true });
    assert.deepEqual((await sent.after.settle())[0], ["published"]);
    assert.equal(linkedIn.requests.length, 1);
    assert.equal((await draftRow(onDraft)).approvedByUserId, null, "the rule's post got an approval it never had");
  });
}
