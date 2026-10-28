// Media and draft checks (step 39): attaching an image or video to a draft
// is a change of content (the next version, an approval taken away) and
// Approve then sees it; the wrong kind, a text post, another company's
// asset, an archived draft or a version that moved on are refused
// (services and /db); taking it off makes an idea of a draft with nothing
// written; a change of media alone leaves the AI's text the AI's; and "Make
// the image with the AI" uses the saved image description and attaches the
// stand-in's image when it is made. The stand-in, and a FAKE model only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { setDraftMedia } from "@/db/content-draft-media";
import { contentDrafts } from "@/db/schema";
import type { SessionContext } from "@/lib/session";
import { archiveDraftForSession } from "@/services/content-review";
import { getContentDraftPageForSession } from "@/services/content-drafts";
import { setDraftMediaForSession } from "@/services/draft-media";
import { deleteMediaForSession } from "@/services/media-deletion";
import { requestDraftImageForSession } from "@/services/media-generation-jobs";
import { messageOf } from "./cofounder-helpers";
import { approveDraft, blankDraftId, draftAnswer, draftRow, editDraft, generatedDraftId, makeReadyForDrafts } from "./content-studio-helpers";
import { assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { collectingAfter, jobRow, MP4, neverRun, PNG, uploadedAssetId } from "./media-helpers";

// The AI's list of claims, every one backed by a fact makeReadyForDrafts confirms.
const BACKED_ONLY = { claims: [{ text: "The bakery bakes sourdough bread in Lisbon.", fact_topics: ["description"] }] };

// A LinkedIn post with an image, written by hand: version 2, a draft.
export async function imagePostDraft(session: SessionContext, imagePrompt = "Three loaves on a counter"): Promise<string> {
  const draftId = await blankDraftId(session, { platform: "linkedin", format: "image_post", topic: `Our loaves ${runId}`, pillar: "", campaign: "" });
  assert.deepEqual(await editDraft(session, draftId, { body: "Fresh every morning.", imagePrompt }), { ok: true });
  return draftId;
}

// Attaches (or, with "", takes off) as the draft's page does, at its version now.
export async function attachToDraft(session: SessionContext, draftId: string, assetId: string) {
  return setDraftMediaForSession(session, { draftId, version: String((await draftRow(draftId)).version), assetId });
}

export async function runMediaDraftChecks() {
  await check("draft media: attaching an image to an approved post with an image makes it a draft again, without its approval, as the next version; Approve then sees the image", async () => {
    const owner = sessionFor(await signUpTestOwner("media-draft"));
    const draftId = await imagePostDraft(owner);
    assert.match(messageOf(await approveDraft(owner, draftId, true)), /needs its image before it can be approved/);
    const first = await uploadedAssetId(owner, PNG, "loaves.png");
    assert.deepEqual(await attachToDraft(owner, draftId, first), { ok: true });
    assert.deepEqual([(await draftRow(draftId)).version, (await draftRow(draftId)).mediaAssetId], [3, first]);
    const page = await getContentDraftPageForSession(owner, draftId);
    assert.ok(page && page.media.attached?.id === first && !page.review.issues.some((issue) => issue.code === "media_missing"));
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    const second = await uploadedAssetId(owner, PNG, "loaves-2.png");
    assert.deepEqual(await attachToDraft(owner, draftId, second), { ok: true });
    const after = await draftRow(draftId);
    assert.deepEqual(
      [after.status, after.version, after.mediaAssetId, after.approvedByUserId, after.approvedVersion, after.claimsAcknowledgedAt, after.updatedByUserId],
      ["draft", 4, second, null, null, null, owner.userId],
    );
  });

  await check("draft media: the wrong kind, a text post, another company's asset, an archived draft and a version that moved on are refused (services and /db), changing nothing", async () => {
    const ownerA = sessionFor(await signUpTestOwner("media-draft-a"));
    const ownerB = sessionFor(await signUpTestOwner("media-draft-b"));
    const draftId = await imagePostDraft(ownerA);
    const video = await uploadedAssetId(ownerA, MP4, "clip.mp4");
    const image = await uploadedAssetId(ownerA, PNG, "loaf.png");
    const assetOfB = await uploadedAssetId(ownerB, PNG, "b.png");
    const before = await draftRow(draftId);
    assert.match(messageOf(await attachToDraft(ownerA, draftId, video)), /A post with an image takes an image, and a video a video/);
    assert.match(messageOf(await attachToDraft(ownerA, draftId, assetOfB)), /couldn't find that image or video/);
    assert.match(messageOf(await attachToDraft(ownerB, draftId, assetOfB)), /couldn't find that draft/);
    assert.match(messageOf(await setDraftMediaForSession(ownerA, { draftId, version: "1", assetId: image })), /Someone changed this draft after you opened it/);
    assert.equal(await setDraftMedia(ownerA.companyId, ownerB.userId, { draftId, version: before.version, assetId: image }), "not-allowed");
    assert.equal(await setDraftMedia(ownerB.companyId, ownerB.userId, { draftId, version: before.version, assetId: null }), "not-found");
    assert.deepEqual(await draftRow(draftId), before);
    const textPost = await blankDraftId(ownerA, { platform: "x", format: "post", topic: "Lunch", pillar: "", campaign: "" });
    assert.deepEqual(await editDraft(ownerA, textPost, { body: "Lunch is on." }), { ok: true });
    assert.match(messageOf(await attachToDraft(ownerA, textPost, image)), /a text post takes neither/);
    await assertRefusedByConstraint(db.update(contentDrafts).set({ mediaAssetId: image }).where(eq(contentDrafts.id, textPost)), "content_drafts_no_media_on_text_post");
    await assertRefusedByConstraint(db.update(contentDrafts).set({ mediaAssetId: assetOfB }).where(eq(contentDrafts.id, draftId)), "content_drafts_media_in_same_company_fk");
    assert.deepEqual(await archiveDraftForSession(ownerA, { draftId }), { ok: true });
    assert.match(messageOf(await attachToDraft(ownerA, draftId, image)), /status changed meanwhile/);
  });

  await check("draft media: an idea with an image attached is a draft, and an idea again once it is taken off; attaching the same one again changes nothing", async () => {
    const owner = sessionFor(await signUpTestOwner("media-draft-idea"));
    const ideaId = await blankDraftId(owner, { platform: "facebook", format: "image_post", topic: "Bread", pillar: "", campaign: "" });
    const image = await uploadedAssetId(owner, PNG, "bread.png");
    assert.deepEqual(await attachToDraft(owner, ideaId, image), { ok: true });
    assert.deepEqual([(await draftRow(ideaId)).status, (await draftRow(ideaId)).version], ["draft", 2]);
    assert.deepEqual(await attachToDraft(owner, ideaId, image), { ok: true });
    assert.equal((await draftRow(ideaId)).version, 2, "attaching the same image again made a version");
    assert.deepEqual(await attachToDraft(owner, ideaId, ""), { ok: true });
    const idea = await draftRow(ideaId);
    assert.deepEqual([idea.status, idea.version, idea.mediaAssetId], ["idea", 3, null]);
    // The database's own rule: an idea has nothing attached.
    await assertRefusedByConstraint(db.update(contentDrafts).set({ mediaAssetId: image }).where(eq(contentDrafts.id, ideaId)), "content_drafts_idea_has_no_content");
  });

  await check("draft media: attaching, taking off or deleting the image of a post the AI wrote leaves its text the AI's (claims current: no 'I checked these claims', Regenerate doesn't ask); a hand edit still counts, and a hand-written draft stays one", async () => {
    const owner = sessionFor(await signUpTestOwner("media-draft-ai"));
    await makeReadyForDrafts(owner);
    const request = { platform: "linkedin", format: "image_post", topic: `Loaves ${runId}`, pillar: "", campaign: "" };
    const draftId = await generatedDraftId(owner, request, draftAnswer({ ...BACKED_ONLY, image_prompt: "Three loaves on a counter" }));
    const claimsOf = async () => {
      const page = await getContentDraftPageForSession(owner, draftId);
      return [page?.review.claimsState, page?.review.acknowledgmentNeeded, page?.editedByHand];
    };
    const versionsOf = async () => [(await draftRow(draftId)).version, (await draftRow(draftId)).generatedVersion];
    const first = await uploadedAssetId(owner, PNG, "first.png");
    assert.deepEqual(await attachToDraft(owner, draftId, first), { ok: true });
    assert.deepEqual([await versionsOf(), await claimsOf()], [[2, 2], ["current", false, false]]);
    assert.deepEqual(await approveDraft(owner, draftId, false), { ok: true });
    assert.deepEqual(await attachToDraft(owner, draftId, ""), { ok: true });
    assert.deepEqual(await attachToDraft(owner, draftId, first), { ok: true });
    // The library deleting it: the draft loses it as its next version.
    assert.deepEqual(await deleteMediaForSession(owner, { assetId: first }), { ok: true });
    assert.deepEqual([await versionsOf(), (await draftRow(draftId)).mediaAssetId, await claimsOf()], [[5, 5], null, ["current", false, false]]);
    // A hand edit changes the text: it stays changed through a new image.
    assert.deepEqual(await editDraft(owner, draftId, { body: "Now 50% off everything!" }), { ok: true });
    assert.deepEqual(await attachToDraft(owner, draftId, await uploadedAssetId(owner, PNG, "second.png")), { ok: true });
    assert.deepEqual([await versionsOf(), await claimsOf()], [[7, 5], ["edited", true, true]]);
    const handWritten = await imagePostDraft(owner);
    assert.deepEqual(await attachToDraft(owner, handWritten, await uploadedAssetId(owner, PNG, "third.png")), { ok: true });
    assert.equal((await draftRow(handWritten)).generatedVersion, null);
  });

  await check("draft media: 'Make the image with the AI' uses the saved image description; the stand-in's image is attached as the next version, taking an approval away", async () => {
    const owner = sessionFor(await signUpTestOwner("media-draft-make"));
    const prompt = `Sourdough on a marble counter ${runId}`;
    const draftId = await imagePostDraft(owner, prompt);
    assert.deepEqual(await attachToDraft(owner, draftId, await uploadedAssetId(owner, PNG, "first.png")), { ok: true });
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    const after = collectingAfter();
    const result = await requestDraftImageForSession(owner, { draftId, version: "3" }, after.run);
    assert.ok(result.ok, messageOf(result));
    // While it is being made, another request for the draft is refused.
    assert.match(messageOf(await requestDraftImageForSession(owner, { draftId, version: "3" }, neverRun)), /already being made/);
    assert.deepEqual(await after.settle(), ["succeeded"]);
    const job = await jobRow(result.jobId);
    assert.deepEqual([job.prompt, job.draftId, job.status], [prompt, draftId, "succeeded"]);
    const draft = await draftRow(draftId);
    assert.deepEqual([draft.mediaAssetId, draft.version, draft.status, draft.approvedByUserId], [job.assetId, 4, "draft", null]);
    const page = await getContentDraftPageForSession(owner, draftId);
    assert.deepEqual([page?.media.attached?.source, page?.media.attached?.provider, page?.media.openJob], ["generated", "dev-stand-in", null]);
  });

  await check("draft media: 'Make the image with the AI' is refused for a version that moved on, without a description, on a video, and for another company; a draft archived meanwhile keeps its version, the image stays in the library", async () => {
    const owner = sessionFor(await signUpTestOwner("media-draft-make-no"));
    const other = sessionFor(await signUpTestOwner("media-draft-make-other"));
    const draftId = await imagePostDraft(owner);
    assert.match(messageOf(await requestDraftImageForSession(owner, { draftId, version: "1" }, neverRun)), /Someone changed this draft/);
    assert.match(messageOf(await requestDraftImageForSession(other, { draftId, version: "2" }, neverRun)), /couldn't find that draft/);
    const undescribed = await imagePostDraft(owner, "");
    assert.match(messageOf(await requestDraftImageForSession(owner, { draftId: undescribed, version: "2" }, neverRun)), /Describe the image first/);
    const videoDraft = await blankDraftId(owner, { platform: "youtube", format: "video", topic: "Baking", pillar: "", campaign: "" });
    assert.match(messageOf(await requestDraftImageForSession(owner, { draftId: videoDraft, version: "1" }, neverRun)), /Only a post with an image/);
    const after = collectingAfter();
    const result = await requestDraftImageForSession(owner, { draftId, version: "2" }, after.run);
    assert.ok(result.ok, messageOf(result));
    assert.deepEqual(await archiveDraftForSession(owner, { draftId }), { ok: true });
    const archived = await draftRow(draftId);
    assert.deepEqual(await after.settle(), ["succeeded"]);
    assert.deepEqual(await draftRow(draftId), archived);
    assert.ok((await jobRow(result.jobId)).assetId, "the image was not kept");
  });
}
