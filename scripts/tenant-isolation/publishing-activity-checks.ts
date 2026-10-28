// Co-Founder activity log checks (step 41): every change writes its row,
// with who did it, inside the transaction that makes the change (connecting
// and disconnecting accounts, a teammate's removal, a refused token,
// approving, rejecting, archiving, restoring, a new plan); a change that
// doesn't happen writes none; the queue and a draft's page list it in plain
// words, a company's own only; no row or log line holds a token or a
// post's text. Through the real services and /db.

import assert from "node:assert/strict";
import { getTableColumns } from "drizzle-orm";
import { cofounderActivity } from "@/db/schema";
import { describeActivity } from "@/lib/publishing/activity-text";
import { archiveDraftForSession, rejectDraftForSession, restoreDraftForSession } from "@/services/content-review";
import { getDraftPublishingForSession } from "@/services/draft-publishing";
import { getQueuePageForSession } from "@/services/publishing-pages";
import { disconnectSocialAccountForSession } from "@/services/social-disconnect";
import { removeTeammateForSession } from "@/services/team";
import { approveDraft, draftRow, generatedDraftId, LINKEDIN_POST, makeReadyForDrafts } from "./content-studio-helpers";
import { addTeammate, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { makeWorkingPlan } from "./marketing-plan-helpers";
import { collectingAfter } from "./media-helpers";
import {
  activityRows,
  jobRowsOfDraft,
  linkedInPosted,
  makeDue,
  ownerWithApprovedDraft,
  realLinkedInAccount,
  runNow,
  schedule,
  scheduledJobIds,
  throughFakePlatform,
} from "./publishing-helpers";
import { connectFully, fakePlatform, linkedInConnects } from "./social-helpers";

// One company's log as "action:actor:code" lines, oldest first.
async function logOf(companyId: string): Promise<string[]> {
  return (await activityRows(companyId)).map((entry) => `${entry.action}:${entry.actorUserId ?? "app"}:${entry.code ?? ""}`);
}

export async function runPublishingActivityChecks() {
  await check("activity: connecting and disconnecting an account, a teammate's removal disconnecting their profile, approving, rejecting, archiving, restoring and a new plan each write their row with who did it", async () => {
    const ownerUser = await signUpTestOwner("log-changes");
    const owner = sessionFor(ownerUser);
    await makeReadyForDrafts(owner);
    const teammate = sessionFor(await addTeammate(ownerUser, "log-changes-owner", "owner"));
    await connectFully(owner, "linkedin", linkedInConnects(`member${runId}lg`));
    await connectFully(teammate, "linkedin", linkedInConnects(`member${runId}lt`));
    const before = await logOf(owner.companyId);
    assert.deepEqual(before, [`connected:${owner.userId}:`, `connected:${teammate.userId}:`]);
    const [ownersAccount] = (await activityRows(owner.companyId)).map((entry) => entry.connectionId);
    assert.deepEqual(await disconnectSocialAccountForSession(owner, { connectionId: ownersAccount }, collectingAfter().run), { ok: true });
    assert.deepEqual(await removeTeammateForSession(owner, { userId: teammate.userId }), { ok: true });
    const draftId = await generatedDraftId(owner, { ...LINKEDIN_POST, topic: `Logged ${runId}` });
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    assert.deepEqual(await rejectDraftForSession(owner, { draftId, version: "1", note: "Too long" }), { ok: true });
    assert.deepEqual(await archiveDraftForSession(owner, { draftId }), { ok: true });
    assert.deepEqual(await restoreDraftForSession(owner, { draftId }), { ok: true });
    const planVersion = await makeWorkingPlan(owner);
    const after = (await logOf(owner.companyId)).slice(before.length);
    assert.deepEqual(after, [
      `disconnected:${owner.userId}:`,
      "disconnected:app:teammate_removed",
      `draft_approved:${owner.userId}:`,
      `draft_rejected:${owner.userId}:`,
      `draft_archived:${owner.userId}:`,
      `draft_restored:${owner.userId}:`,
      `plan_created:${owner.userId}:`,
    ]);
    assert.equal((await activityRows(owner.companyId)).at(-1)?.planVersion, planVersion);
  });

  await check("activity: a change that doesn't happen writes nothing: a refused schedule, a second schedule refused by the database (its transaction rolled back), an approval of a draft approved already", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("log-nothing");
    const account = await realLinkedInAccount(owner, `member${runId}ln`);
    const before = await logOf(owner.companyId);
    assert.equal((await schedule(owner, draftId, [account], new Date(Date.now() - 5 * 60_000))).result.ok, false);
    assert.equal((await schedule(owner, draftId, [account], new Date(Date.now() + 400 * 24 * 3_600_000))).result.ok, false);
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    assert.deepEqual(await logOf(owner.companyId), before, "a refused or empty change was logged");
    const both = await Promise.all([schedule(owner, draftId, [account], new Date(Date.now() + 3_600_000)), schedule(owner, draftId, [account], new Date(Date.now() + 3_600_000))]);
    assert.deepEqual(both.map((attempt) => attempt.result.ok).sort(), [false, true]);
    const scheduledRows = (await activityRows(owner.companyId)).filter((entry) => entry.action === "scheduled");
    assert.deepEqual([scheduledRows.length, scheduledRows[0]?.jobId], [1, (await jobRowsOfDraft(draftId))[0].id]);
  });

  await check("activity: the queue page lists the company's newest entries in plain words and a draft's page its own; another company's never show; no column holds a token or a post's text, and a run's log lines hold neither", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("log-pages");
    const other = await ownerWithApprovedDraft("log-pages-other");
    const account = await realLinkedInAccount(owner, `member${runId}lp`);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    await makeDue(jobId);
    const run = await captureConsole(() => runNow(owner, jobId, throughFakePlatform(fakePlatform([new Response(null, { status: 503 })]).fetchFn)));
    assert.equal(run.result, "needs_attention");
    const draft = await draftRow(draftId);
    for (const line of run.logs) {
      assert.ok(!line.includes(draft.body.slice(0, 20)) && !line.includes(`li-access-${runId}`), `a log line holds the post or the token: ${line}`);
    }
    assert.deepEqual(run.logs, ["Publish job needs attention: linkedin server_error"]);
    const queue = await getQueuePageForSession(owner);
    const sentences = queue.activity.map((entry) => describeActivity(entry));
    assert.ok(sentences.some((sentence) => sentence.startsWith(`Owner log-pages scheduled “${draft.topic}” for LinkedIn (Ana Baker)`)), sentences.join("\n"));
    assert.ok(sentences.some((sentence) => sentence.startsWith(`“${draft.topic}” needs attention on LinkedIn (Ana Baker).`)), sentences.join("\n"));
    assert.ok(!queue.activity.some((entry) => entry.draftId === other.draftId));
    const otherQueue = await getQueuePageForSession(other.owner);
    assert.ok(!otherQueue.activity.some((entry) => entry.draftId === draftId || entry.jobId === jobId), "another company sees the log");
    const panel = await getDraftPublishingForSession(owner, draft);
    assert.ok(panel.activity.length > 0 && panel.activity.every((entry) => entry.draftId === draftId));
    assert.deepEqual(Object.keys(getTableColumns(cofounderActivity)).sort(), ["action", "actorUserId", "code", "companyId", "connectionId", "createdAt", "draftId", "id", "jobId", "planVersion", "ruleId"]);
    const published = fakePlatform([linkedInPosted("urn:li:share:7000000000000001001")]);
    const retry = await captureConsole(async () => {
      const second = await realLinkedInAccount(owner, `member${runId}lp2`);
      const [secondJob] = await scheduledJobIds(owner, draftId, [second]);
      await makeDue(secondJob);
      return runNow(owner, secondJob, throughFakePlatform(published.fetchFn));
    });
    assert.equal(retry.result, "published");
    assert.ok(!retry.logs.some((line) => line.includes(draft.body.slice(0, 20))), "a published post's text was logged");
  });
}
