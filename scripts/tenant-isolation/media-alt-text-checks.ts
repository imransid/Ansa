// Media alt text checks (step 39 review): an image's alt text is published
// with it, so changing it in the library is a change of content of every
// draft using it (the next version, without its approval; an archived one
// stays archived), refused while a draft that is scheduled, published or
// failed to publish uses it; a word to avoid in it blocks approval; and a
// change at the moment of an approval never leaves an approved draft with
// words its owner didn't see.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approveContentDraft } from "@/db/content-draft-status";
import { updateMediaAltText } from "@/db/media-alt-text";
import { contentDrafts } from "@/db/schema";
import type { SessionContext } from "@/lib/session";
import { archiveDraftForSession } from "@/services/content-review";
import { getContentDraftPageForSession } from "@/services/content-drafts";
import { listMediaForSession, saveMediaAltTextForSession } from "@/services/media-library";
import { messageOf, typeFact } from "./cofounder-helpers";
import { approveDraft, draftRow } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { attachToDraft, imagePostDraft } from "./media-draft-checks";
import { assetRow, PNG, upload } from "./media-helpers";

// Uploads a PNG with this alt text, as the media page does: the new asset's id.
async function uploadedWithAltText(session: SessionContext, altText: string): Promise<string> {
  assert.deepEqual(await upload(session, PNG, "loaves.png", altText), { ok: true });
  const [newest] = await listMediaForSession(session, 1);
  return newest.id;
}

export async function runMediaAltTextChecks() {
  await check("media alt text: a change is the next version of every draft using the image, without its approval (an approved one is a draft again, an archived one stays archived); the same text again changes nothing", async () => {
    const ownerUser = await signUpTestOwner("media-alt-drafts");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "media-alt-mate", "member"));
    const assetId = await uploadedWithAltText(owner, "Fresh loaves on our counter");
    const [approved, archived, drafting] = [await imagePostDraft(owner), await imagePostDraft(owner), await imagePostDraft(owner)];
    for (const draftId of [approved, archived, drafting]) {
      assert.deepEqual(await attachToDraft(owner, draftId, assetId), { ok: true });
    }
    assert.deepEqual(await approveDraft(owner, approved, true), { ok: true });
    assert.deepEqual(await archiveDraftForSession(owner, { draftId: archived }), { ok: true });
    const shownVersion = (await draftRow(approved)).version;
    assert.deepEqual(await saveMediaAltTextForSession(member, { assetId, altText: `Three loaves ${runId}` }), { ok: true });
    assert.equal((await assetRow(assetId)).altText, `Three loaves ${runId}`);
    const rows = [await draftRow(approved), await draftRow(archived), await draftRow(drafting)];
    assert.deepEqual(
      rows.map((row) => [row.status, row.version, row.approvedByUserId, row.updatedByUserId]),
      [
        ["draft", 4, null, member.userId],
        ["archived", 4, null, member.userId],
        ["draft", 4, null, member.userId],
      ],
    );
    // The owner's page showed the old text: approving that version is refused.
    const late = await approveContentDraft(owner.companyId, owner.userId, { draftId: approved, version: shownVersion, claimsChecked: true });
    assert.deepEqual(late, { outcome: "stale" });
    assert.deepEqual(await saveMediaAltTextForSession(member, { assetId, altText: `Three loaves ${runId}` }), { ok: true });
    assert.equal((await draftRow(drafting)).version, 4, "saving the same text again made a version");
  });

  await check("media alt text: refused while a draft that is scheduled, published or failed to publish uses the image, naming the draft; nothing changes", async () => {
    const owner = sessionFor(await signUpTestOwner("media-alt-kept"));
    const assetId = await uploadedWithAltText(owner, "As approved");
    const draftId = await imagePostDraft(owner);
    assert.deepEqual(await attachToDraft(owner, draftId, assetId), { ok: true });
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    for (const status of ["scheduled", "published", "failed"] as const) {
      await db.update(contentDrafts).set({ status }).where(eq(contentDrafts.id, draftId));
      const before = await draftRow(draftId);
      const message = messageOf(await saveMediaAltTextForSession(owner, { assetId, altText: `Changed while ${status}` }));
      assert.match(message, new RegExp(`can't be changed while the draft “Our loaves ${runId}” \\([^)]+\\) uses it`), status);
      assert.deepEqual([await draftRow(draftId), (await assetRow(assetId)).altText], [before, "As approved"], status);
    }
    await db.update(contentDrafts).set({ status: "approved" }).where(eq(contentDrafts.id, draftId));
  });

  await check("media alt text: a word to avoid in the alt text of a draft's image blocks approval (checked in the approving transaction), and the draft's page says where", async () => {
    const owner = sessionFor(await signUpTestOwner("media-alt-words"));
    await typeFact(owner, "words_to_avoid", "Cheapest, guaranteed");
    const assetId = await uploadedWithAltText(owner, "The cheapest bread in town");
    const draftId = await imagePostDraft(owner);
    assert.deepEqual(await attachToDraft(owner, draftId, assetId), { ok: true });
    const page = await getContentDraftPageForSession(owner, draftId);
    assert.deepEqual(page?.review.blockingIssues.map((issue) => issue.code), ["word_to_avoid"]);
    assert.match(messageOf(await approveDraft(owner, draftId, true)), /"Cheapest" is on your Words to avoid list .* in the image's alt text/);
    assert.equal((await draftRow(draftId)).status, "draft");
    assert.deepEqual(await saveMediaAltTextForSession(owner, { assetId, altText: "Three loaves on a counter" }), { ok: true });
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
  });

  await check("media alt text: a change at the same moment as an approval never leaves the draft approved with the old text: the change takes the approval away, or the approval is refused as stale", async () => {
    const owner = sessionFor(await signUpTestOwner("media-alt-race"));
    for (let round = 0; round < 5; round++) {
      const assetId = await uploadedWithAltText(owner, "Before");
      const draftId = await imagePostDraft(owner);
      assert.deepEqual(await attachToDraft(owner, draftId, assetId), { ok: true });
      const shown = (await draftRow(draftId)).version;
      const [approval, change] = await Promise.all([
        approveContentDraft(owner.companyId, owner.userId, { draftId, version: shown, claimsChecked: true }),
        updateMediaAltText(owner.companyId, owner.userId, { assetId, altText: `Round ${round}` }),
      ]);
      assert.ok(["approved", "stale"].includes(approval.outcome), approval.outcome);
      assert.deepEqual(change, { outcome: "changed" });
      const final = await draftRow(draftId);
      assert.deepEqual([final.status, final.approvedByUserId, final.version], ["draft", null, shown + 1]);
    }
  });
}
