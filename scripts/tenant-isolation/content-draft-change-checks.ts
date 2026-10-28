// Content draft change checks (step 38): an approval records its version;
// editing or regenerating an approved draft makes it a draft again, clears
// the approval and bumps the version in the same write; an edit, approval
// or rejection of a version that moved on is refused and changes nothing,
// also for saves at the same moment; and the AI's new text is never saved
// over an edit made while it was writing. Archive and Restore. A FAKE model
// only: nothing calls Anthropic.

import assert from "node:assert/strict";
import { getContentDraftPageForSession } from "@/services/content-drafts";
import { editDraftForSession } from "@/services/content-draft-edits";
import { regenerateDraftForSession } from "@/services/content-generation";
import { approveDraftForSession, archiveDraftForSession, rejectDraftForSession, restoreDraftForSession } from "@/services/content-review";
import { messageOf, scriptedModel } from "./cofounder-helpers";
import {
  approveDraft,
  blankDraftId,
  draftAnswer,
  draftRow,
  editDraft,
  editorForm,
  generatedDraftId,
  makeReadyForDrafts,
  regenerateDraft,
} from "./content-studio-helpers";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";

const STALE = /Someone changed this draft after you opened it/;

export async function runContentDraftChangeChecks() {
  await check("content studio: an approval records its version; editing or regenerating an approved draft makes it a draft again without its approval, as the next version; an edit changing nothing keeps it", async () => {
    const ownerUser = await signUpTestOwner("studio-versions");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "studio-versions-member", "member"));
    await makeReadyForDrafts(owner);
    const draftId = await generatedDraftId(owner);
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    const approved = await draftRow(draftId);
    assert.deepEqual([approved.status, approved.version, approved.approvedVersion, approved.approvedByUserId], ["approved", 1, 1, owner.userId]);

    // Saving exactly what is stored changes nothing.
    assert.deepEqual(await editDraftForSession(member, await editorForm(draftId)), { ok: true });
    assert.deepEqual(await draftRow(draftId), approved);

    assert.deepEqual(await editDraft(member, draftId, { body: "A member's change." }), { ok: true });
    const edited = await draftRow(draftId);
    assert.deepEqual(
      [edited.status, edited.version, edited.approvedByUserId, edited.approvedAt, edited.approvedVersion, edited.claimsAcknowledgedByUserId, edited.updatedByUserId],
      ["draft", 2, null, null, null, null, member.userId],
    );
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    assert.equal((await draftRow(draftId)).approvedVersion, 2);

    const { result } = await regenerateDraft(member, draftId, draftAnswer({ body: "The AI's second text." }));
    assert.deepEqual(result, { ok: true });
    const regenerated = await draftRow(draftId);
    assert.deepEqual(
      [regenerated.status, regenerated.version, regenerated.generatedVersion, regenerated.approvedVersion, regenerated.body],
      ["draft", 3, 3, null, "The AI's second text."],
    );
    // Only the topic changed: still a change, a new version, approval gone.
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    assert.deepEqual(await editDraft(owner, draftId, { topic: "Another topic" }), { ok: true });
    assert.deepEqual([(await draftRow(draftId)).status, (await draftRow(draftId)).version], ["draft", 4]);
    // An edit that empties everything makes it an idea again.
    const emptied = { title: "", body: "", hashtags: "", callToAction: "", imagePrompt: "", videoScript: "" };
    assert.deepEqual(await editDraft(owner, draftId, emptied), { ok: true });
    assert.deepEqual([(await draftRow(draftId)).status, (await draftRow(draftId)).hashtags], ["idea", []]);
  });

  await check("content studio: an edit, approval or rejection of a version that moved on is refused and changes nothing; of five saves at the same moment exactly one wins", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-stale"));
    await makeReadyForDrafts(owner);
    const draftId = await generatedDraftId(owner);
    // Two editors opened version 1; the second saves first.
    const firstEditor = await editorForm(draftId, { body: "First editor's text." });
    assert.deepEqual(await editDraft(owner, draftId, { body: "Second editor's text." }), { ok: true });
    assert.match(messageOf(await editDraftForSession(owner, firstEditor)), STALE);
    assert.equal((await draftRow(draftId)).body, "Second editor's text.");
    // An owner approving or rejecting what they saw as version 1.
    assert.match(messageOf(await approveDraftForSession(owner, { draftId, version: "1", claimsChecked: "on" })), STALE);
    assert.match(messageOf(await rejectDraftForSession(owner, { draftId, version: "1", note: "No" })), STALE);
    const unchanged = await draftRow(draftId);
    assert.deepEqual([unchanged.status, unchanged.version, unchanged.rejectedAt], ["draft", 2, null]);

    const forms = await Promise.all(Array.from({ length: 5 }, (_, index) => editorForm(draftId, { body: `Save ${index}` })));
    const results = await Promise.all(forms.map((form) => editDraftForSession(owner, form)));
    assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
    const winner = await draftRow(draftId);
    assert.equal(winner.version, 3);
    assert.ok(forms.some((form, index) => results[index].ok && form.body === winner.body));
  });

  await check("content studio: the AI's new text is never saved over an edit made while it was writing; a page showing an older version, or an archived draft, is never regenerated (no Claude call)", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-regen-race"));
    await makeReadyForDrafts(owner);
    const draftId = await generatedDraftId(owner);
    const editWhileWriting = async () => {
      assert.deepEqual(await editDraft(owner, draftId, { body: "Typed while the AI wrote." }), { ok: true });
    };
    const model = scriptedModel([draftAnswer({ body: "The AI's late text." })], editWhileWriting);
    const result = await regenerateDraftForSession(owner, { draftId, version: "1" }, model.ask);
    assert.match(messageOf(result), /changed this draft while the AI was writing/);
    const row = await draftRow(draftId);
    assert.deepEqual([row.body, row.version, row.generatedVersion], ["Typed while the AI wrote.", 2, 1]);

    // The page still shows version 1, edited since: refused before Claude is asked.
    const stalePage = scriptedModel([draftAnswer({ body: "The AI's text for an old page." })]);
    const stale = await regenerateDraftForSession(owner, { draftId, version: "1" }, stalePage.ask);
    assert.match(messageOf(stale), /Someone changed this draft after you opened it, so the AI wasn't asked\. Reload the page/);
    assert.equal(stalePage.requests.length, 0, "Claude was asked for a page showing an older version");
    assert.deepEqual(await draftRow(draftId), row);

    assert.deepEqual(await archiveDraftForSession(owner, { draftId }), { ok: true });
    const archived = scriptedModel([draftAnswer()]);
    assert.match(messageOf(await regenerateDraftForSession(owner, { draftId, version: "2" }, archived.ask)), /restored first/);
    assert.equal(archived.requests.length, 0, "Claude was asked for an archived draft");
  });

  await check("content studio: Archive takes an approval away and keeps the draft out of the current list; Restore makes it a draft (an idea when empty) to be approved again", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-archive"));
    await makeReadyForDrafts(owner);
    const draftId = await generatedDraftId(owner);
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    assert.deepEqual(await archiveDraftForSession(owner, { draftId }), { ok: true });
    const archived = await draftRow(draftId);
    assert.deepEqual([archived.status, archived.approvedByUserId, archived.approvedVersion, archived.version], ["archived", null, null, 1]);
    // Archiving again, and restoring something not archived, change nothing.
    assert.deepEqual(await archiveDraftForSession(owner, { draftId }), { ok: true });
    assert.deepEqual(await restoreDraftForSession(owner, { draftId }), { ok: true });
    assert.deepEqual(await restoreDraftForSession(owner, { draftId }), { ok: true });
    assert.equal((await draftRow(draftId)).status, "draft");
    assert.equal((await getContentDraftPageForSession(owner, draftId))?.approval, null);
    const idea = await blankDraftId(owner);
    assert.deepEqual(await archiveDraftForSession(owner, { draftId: idea }), { ok: true });
    assert.deepEqual(await restoreDraftForSession(owner, { draftId: idea }), { ok: true });
    assert.equal((await draftRow(idea)).status, "idea");
    assert.match(messageOf(await archiveDraftForSession(owner, { draftId: "not-an-id" })), /Unknown draft/);
  });
}
