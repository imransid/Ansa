// Media delete checks (step 39): an image or video is never deleted while a
// draft that is approved, scheduled, published or failed to publish uses
// it (the refusal names the draft); otherwise the drafts using it lose it as
// their next version (an archived one stays archived), the job that made it
// keeps its history, and the file goes. An attach or an approval at the
// same moment as a delete never leaves a draft pointing at a deleted file,
// nor an approved draft without its image.

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approveContentDraft } from "@/db/content-draft-status";
import { setDraftMedia } from "@/db/content-draft-media";
import { deleteMediaAsset } from "@/db/media-asset-deletion";
import { contentDrafts } from "@/db/schema";
import { archiveDraftForSession } from "@/services/content-review";
import { deleteMediaForSession } from "@/services/media-deletion";
import { listMediaForSession } from "@/services/media-library";
import { listGenerationJobsForSession, requestGenerationForSession } from "@/services/media-generation-jobs";
import { messageOf } from "./cofounder-helpers";
import { approveDraft, draftRow } from "./content-studio-helpers";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { attachToDraft, imagePostDraft } from "./media-draft-checks";
import { assetRow, collectingAfter, jobRow, PNG, uploadedAssetId } from "./media-helpers";

async function fileExists(storageKey: string): Promise<boolean> {
  return access(path.join(process.cwd(), ".dev-files", storageKey)).then(
    () => true,
    () => false,
  );
}

export async function runMediaDeleteChecks() {
  await check("media delete: refused while an approved, scheduled, published or failed draft uses it, naming the draft; nothing changes", async () => {
    const owner = sessionFor(await signUpTestOwner("media-keep"));
    const assetId = await uploadedAssetId(owner, PNG, "kept.png");
    const draftId = await imagePostDraft(owner);
    assert.deepEqual(await attachToDraft(owner, draftId, assetId), { ok: true });
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    const draftBefore = await draftRow(draftId);
    const message = messageOf(await deleteMediaForSession(owner, { assetId }));
    assert.match(message, new RegExp(`the draft “Our loaves ${runId}” \\(Approved\\) uses it`));
    assert.match(message, /Take it off the draft first, or archive the draft/);
    for (const status of ["scheduled", "published", "failed"] as const) {
      await db.update(contentDrafts).set({ status }).where(eq(contentDrafts.id, draftId));
      assert.match(messageOf(await deleteMediaForSession(owner, { assetId })), /can't be deleted while the draft/, status);
    }
    await db.update(contentDrafts).set({ status: "approved" }).where(eq(contentDrafts.id, draftId));
    assert.deepEqual(await draftRow(draftId), draftBefore);
    const asset = await assetRow(assetId);
    assert.ok(asset && (await fileExists(asset.storageKey)), "the asset or its file is gone");
  });

  await check("media delete: drafts using it lose it as their next version (an archived one stays archived), the job that made it keeps its history, and the file goes", async () => {
    const owner = sessionFor(await signUpTestOwner("media-delete"));
    const after = collectingAfter();
    const made = await requestGenerationForSession(owner, { kind: "image", prompt: "Croissants" }, after.run);
    assert.ok(made.ok, messageOf(made));
    await after.settle();
    const assetId = (await jobRow(made.jobId)).assetId;
    assert.ok(assetId);
    const storageKey = (await assetRow(assetId)).storageKey;
    const drafting = await imagePostDraft(owner);
    const archived = await imagePostDraft(owner);
    assert.deepEqual(await attachToDraft(owner, drafting, assetId), { ok: true });
    assert.deepEqual(await attachToDraft(owner, archived, assetId), { ok: true });
    assert.deepEqual(await archiveDraftForSession(owner, { draftId: archived }), { ok: true });
    assert.deepEqual(await deleteMediaForSession(owner, { assetId }), { ok: true });
    assert.equal(await assetRow(assetId), undefined);
    assert.equal(await fileExists(storageKey), false);
    const [first, second] = [await draftRow(drafting), await draftRow(archived)];
    assert.deepEqual([first.mediaAssetId, first.version, first.status], [null, 4, "draft"]);
    assert.deepEqual([second.mediaAssetId, second.version, second.status], [null, 4, "archived"]);
    const job = await jobRow(made.jobId);
    assert.deepEqual([job.status, job.assetId], ["succeeded", null]);
    assert.ok(job.assetDeletedAt);
    const [listedJob] = await listGenerationJobsForSession(owner);
    assert.deepEqual([listedJob.id, listedJob.assetId, listedJob.status], [made.jobId, null, "succeeded"]);
    assert.deepEqual(await listMediaForSession(owner, 1), []);
    assert.match(messageOf(await deleteMediaForSession(owner, { assetId })), /couldn't find that image or video/);
  });

  await check("media delete: an attach, or an approval, at the same moment as a delete never leaves a draft with a deleted image, nor an approved draft without its image", async () => {
    const owner = sessionFor(await signUpTestOwner("media-race"));
    for (let round = 0; round < 5; round++) {
      // Attach and delete at once: either order ends with no image on the draft, and no asset.
      const assetId = await uploadedAssetId(owner, PNG, `race-${round}.png`);
      const draftId = await imagePostDraft(owner);
      const version = (await draftRow(draftId)).version;
      const [attached, deleted] = await Promise.all([
        setDraftMedia(owner.companyId, owner.userId, { draftId, version, assetId }),
        deleteMediaAsset(owner.companyId, owner.userId, assetId),
      ]);
      assert.ok(["changed", "media-not-found"].includes(attached), attached);
      assert.equal(deleted.outcome, "deleted");
      assert.deepEqual([(await draftRow(draftId)).mediaAssetId, await assetRow(assetId)], [null, undefined]);
      // Approve and delete at once: approved means its image is still there.
      const keptId = await uploadedAssetId(owner, PNG, `race-kept-${round}.png`);
      const approving = await imagePostDraft(owner);
      assert.deepEqual(await attachToDraft(owner, approving, keptId), { ok: true });
      const shown = (await draftRow(approving)).version;
      const [approval, removal] = await Promise.all([
        approveContentDraft(owner.companyId, owner.userId, { draftId: approving, version: shown, claimsChecked: true }),
        deleteMediaAsset(owner.companyId, owner.userId, keptId),
      ]);
      const finalDraft = await draftRow(approving);
      if (finalDraft.status === "approved") {
        assert.deepEqual([approval.outcome, removal.outcome, finalDraft.mediaAssetId], ["approved", "in-use", keptId]);
        assert.ok(await assetRow(keptId));
      } else {
        assert.deepEqual([removal.outcome, finalDraft.mediaAssetId], ["deleted", null]);
        assert.ok(["stale", "blocked"].includes(approval.outcome), approval.outcome);
      }
    }
  });
}
