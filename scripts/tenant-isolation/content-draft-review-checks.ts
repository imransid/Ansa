// Content draft review checks (step 38): members write, edit, regenerate,
// archive and restore drafts but never approve or reject them (services and
// /db), also as an owner made a member meanwhile; a blocking issue stops
// approval, checked on the saved draft inside the transaction; and a claim
// no confirmed fact backs (or claims nobody listed) needs "I checked these
// claims", recorded with the approval. A FAKE model only: nothing calls
// Anthropic.

import assert from "node:assert/strict";
import { approveContentDraft, rejectContentDraft } from "@/db/content-draft-status";
import { archiveDraftForSession, rejectDraftForSession, restoreDraftForSession } from "@/services/content-review";
import { getContentDraftPageForSession } from "@/services/content-drafts";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { changeTeammateRoleForSession } from "@/services/team";
import { messageOf, typeFact } from "./cofounder-helpers";
import {
  approveDraft,
  blankDraftId,
  draftAnswer,
  draftRow,
  editDraft,
  generatedDraftId,
  makeReadyForDrafts,
  regenerateDraft,
} from "./content-studio-helpers";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";

const X_POST = { platform: "x", format: "post", topic: "Lunch", pillar: "", campaign: "" };
const BACKED_ONLY = { claims: [{ text: "The bakery bakes sourdough bread in Lisbon.", fact_topics: ["description"] }] };

export async function runContentDraftReviewChecks() {
  await check("content studio: members write, edit, regenerate, archive and restore drafts, but can't approve or reject them (services and /db); an owner made a member meanwhile is refused", async () => {
    const ownerUser = await signUpTestOwner("studio-roles");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "studio-member", "member"));
    await makeReadyForDrafts(owner);
    const draftId = await generatedDraftId(member);
    assert.deepEqual(await editDraft(member, draftId, { body: "Written by a member." }), { ok: true });
    assert.ok((await regenerateDraft(member, draftId)).result.ok);
    assert.deepEqual(await archiveDraftForSession(member, { draftId }), { ok: true });
    assert.deepEqual(await restoreDraftForSession(member, { draftId }), { ok: true });
    assert.equal((await draftRow(await blankDraftId(member))).status, "idea");
    const rowBefore = await draftRow(draftId);
    assert.deepEqual([rowBefore.status, rowBefore.version, rowBefore.createdByUserId], ["draft", 3, member.userId]);

    assert.match(messageOf(await approveDraft(member, draftId, true)), /Only owners can approve or reject drafts/);
    assert.match(messageOf(await rejectDraftForSession(member, { draftId, version: "3", note: null })), /Only owners/);
    assert.deepEqual(await approveContentDraft(member.companyId, member.userId, { draftId, version: 3, claimsChecked: true }), { outcome: "not-allowed" });
    assert.equal(await rejectContentDraft(member.companyId, member.userId, { draftId, version: 3, note: null }), "not-allowed");
    assert.deepEqual(await draftRow(draftId), rowBefore);
    // The role is checked before anything counts: a member over the limit still hears "Only owners".
    for (let attempt = 0; attempt < RATE_LIMITS.contentDraftChangesPerUser.maxAttempts; attempt++) {
      await isOverRateLimit("content-draft-changes", member.userId, RATE_LIMITS.contentDraftChangesPerUser);
    }
    assert.match(messageOf(await approveDraft(member, draftId, true)), /Only owners/);
    assert.match(messageOf(await rejectDraftForSession(member, { draftId, version: "3", note: null })), /Only owners/);

    // The session still says "owner", as one read just before the change would.
    const demotedUser = await addTeammate(ownerUser, "studio-demoted", "owner");
    assert.deepEqual(await changeTeammateRoleForSession(owner, { userId: demotedUser.id, role: "member" }), { ok: true });
    const staleSession = sessionFor(demotedUser);
    assert.match(messageOf(await approveDraft(staleSession, draftId, true)), /Only owners/);
    assert.match(messageOf(await rejectDraftForSession(staleSession, { draftId, version: "3", note: null })), /Only owners/);
    assert.deepEqual(await draftRow(draftId), rowBefore);
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
  });

  await check("content studio: a blocking issue stops approval, checked on the saved draft in the approving transaction: X's length, a word to avoid confirmed after the page showed the draft, a video without its video", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-blocked"));
    await makeReadyForDrafts(owner);
    const xDraft = await generatedDraftId(owner, X_POST, draftAnswer({ body: "a".repeat(300), hashtags: [], call_to_action: "" }));
    assert.match(messageOf(await approveDraft(owner, xDraft, true)), /can't be approved yet: The post is 300 characters as X counts them.*X allows 280/);
    assert.deepEqual([(await draftRow(xDraft)).status, (await draftRow(xDraft)).approvedByUserId], ["draft", null]);
    assert.deepEqual(await editDraft(owner, xDraft, { body: "a".repeat(280) }), { ok: true });
    assert.deepEqual(await approveDraft(owner, xDraft, true), { ok: true });

    const linkedInDraft = await generatedDraftId(owner);
    const page = await getContentDraftPageForSession(owner, linkedInDraft);
    assert.deepEqual(page?.review.blockingIssues, []);
    // An owner adds a word to avoid after the page showed the draft.
    await typeFact(owner, "words_to_avoid", "Sourdough, guaranteed");
    const blocked = await approveContentDraft(owner.companyId, owner.userId, { draftId: linkedInDraft, version: 1, claimsChecked: true });
    assert.equal(blocked.outcome, "blocked");
    assert.deepEqual(blocked.outcome === "blocked" ? blocked.issues.map((issue) => issue.code) : [], ["word_to_avoid"]);
    assert.match(messageOf(await approveDraft(owner, linkedInDraft, true)), /"Sourdough" is on your Words to avoid list/);
    assert.equal((await draftRow(linkedInDraft)).status, "draft");

    const videoRequest = { platform: "youtube", format: "video", topic: "How we bake", pillar: "", campaign: "" };
    const videoDraft = await generatedDraftId(owner, videoRequest, draftAnswer({ title: "How we bake", body: "Every morning.", video_script: "Scene 1: the oven." }));
    assert.match(messageOf(await approveDraft(owner, videoDraft, true)), /needs its video before it can be approved/);
    assert.equal((await draftRow(videoDraft)).status, "draft");
  });

  await check("content studio: a claim no confirmed fact backs needs 'I checked these claims', and so does a text written or changed by hand or a fact changed since; the owner who ticked it is recorded", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-claims"));
    await makeReadyForDrafts(owner);
    const unbacked = await generatedDraftId(owner);
    assert.match(messageOf(await approveDraft(owner, unbacked, false)), /Some claims aren't backed .* tick "I checked these claims"/);
    assert.equal((await draftRow(unbacked)).status, "draft");
    assert.deepEqual(await approveDraft(owner, unbacked, true), { ok: true });
    const approved = await draftRow(unbacked);
    assert.deepEqual([approved.status, approved.claimsAcknowledgedByUserId, approved.claimsAcknowledgedAt !== null], ["approved", owner.userId, true]);

    // Every claim backed: no tick needed, and none recorded.
    const backed = await generatedDraftId(owner, undefined, draftAnswer(BACKED_ONLY));
    assert.deepEqual(await approveDraft(owner, backed, false), { ok: true });
    assert.equal((await draftRow(backed)).claimsAcknowledgedByUserId, null);

    // Changed by hand since the AI listed its claims.
    const edited = await generatedDraftId(owner, undefined, draftAnswer(BACKED_ONLY));
    assert.deepEqual(await editDraft(owner, edited, { body: "Now 50% off everything!" }), { ok: true });
    assert.equal((await getContentDraftPageForSession(owner, edited))?.review.claimsState, "edited");
    assert.match(messageOf(await approveDraft(owner, edited, false)), /I checked these claims/);
    assert.deepEqual(await approveDraft(owner, edited, true), { ok: true });

    // Written by hand: nobody listed its claims.
    const handWritten = await blankDraftId(owner);
    assert.deepEqual(await editDraft(owner, handWritten, { body: "The best bread in Lisbon." }), { ok: true });
    assert.equal((await getContentDraftPageForSession(owner, handWritten))?.review.claimsState, "written_by_hand");
    assert.match(messageOf(await approveDraft(owner, handWritten, false)), /I checked these claims/);

    // The fact behind a backed claim changed after the draft was written.
    const factChanged = await generatedDraftId(owner, undefined, draftAnswer(BACKED_ONLY));
    await typeFact(owner, "description", "Bluebird Bakery bakes rye bread in Porto.");
    const claims = (await getContentDraftPageForSession(owner, factChanged))?.review.claims;
    assert.deepEqual(claims?.map((claim) => claim.status), ["fact_changed"]);
    assert.match(messageOf(await approveDraft(owner, factChanged, false)), /I checked these claims/);
    assert.equal((await draftRow(factChanged)).status, "draft");
  });

  await check("content studio: rejecting (owners) keeps the note through edits until an approval; an approved draft rejected loses its approval; an idea or an archived draft can't be decided on", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-reject"));
    await makeReadyForDrafts(owner);
    const draftId = await generatedDraftId(owner);
    assert.deepEqual(await rejectDraftForSession(owner, { draftId, version: "1", note: "Too salesy.\r\nShorter, please." }), { ok: true });
    const rejected = await draftRow(draftId);
    assert.deepEqual([rejected.status, rejected.rejectedByUserId, rejected.rejectionNote], ["rejected", owner.userId, "Too salesy.\nShorter, please."]);
    assert.deepEqual(await editDraft(owner, draftId, { body: "Shorter." }), { ok: true });
    const reworked = await getContentDraftPageForSession(owner, draftId);
    assert.deepEqual([reworked?.status, reworked?.rejection?.note], ["draft", "Too salesy.\nShorter, please."]);
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    const approved = await draftRow(draftId);
    assert.deepEqual([approved.status, approved.rejectedAt, approved.rejectionNote], ["approved", null, null]);
    assert.deepEqual(await rejectDraftForSession(owner, { draftId, version: "2", note: "" }), { ok: true });
    const rejectedAgain = await draftRow(draftId);
    assert.deepEqual([rejectedAgain.status, rejectedAgain.approvedByUserId, rejectedAgain.approvedVersion, rejectedAgain.rejectionNote], ["rejected", null, null, null]);

    const idea = await blankDraftId(owner);
    assert.match(messageOf(await rejectDraftForSession(owner, { draftId: idea, version: "1", note: null })), /status changed/);
    assert.match(messageOf(await approveDraft(owner, idea, true)), /status changed/);
    assert.deepEqual(await archiveDraftForSession(owner, { draftId }), { ok: true });
    assert.match(messageOf(await approveDraft(owner, draftId, true)), /status changed/);
    assert.match(messageOf(await editDraft(owner, draftId, { body: "x" })), /status changed/);
    assert.match(messageOf(await rejectDraftForSession(owner, { draftId, version: "2", note: "" })), /must be restored first/);
    const note = await rejectDraftForSession(owner, { draftId: idea, version: "1", note: "n".repeat(501) });
    assert.match(messageOf(note), /at most 500/);
  });
}
