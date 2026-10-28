// Content draft checks (step 38): one company's drafts never reach another
// (services and /db), Postgres refuses what the code would never write (a
// person or a plan version from another company, an approval of another
// version, a title off YouTube, a text post on YouTube), its CHECKs list
// the code's own platforms, formats and statuses, and a form carrying
// fields of its own writes only what the editor may change. A FAKE model
// only: nothing calls Anthropic.

import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { countContentDraftsPerStatus, getContentDraftForCompany, getContentDraftsForCompany } from "@/db/content-drafts";
import { approveContentDraft, archiveContentDraft, rejectContentDraft, restoreContentDraft } from "@/db/content-draft-status";
import { editContentDraft, saveRegeneratedDraft } from "@/db/content-draft-writes";
import { contentDrafts } from "@/db/schema";
import { contentDraftStatuses, contentFormats } from "@/lib/content-studio/formats";
import { socialPlatforms } from "@/lib/social-platforms";
import { getContentDraftPageForSession, listContentDraftsForSession } from "@/services/content-drafts";
import { regenerateDraftForSession } from "@/services/content-generation";
import { approveDraftForSession, archiveDraftForSession, rejectDraftForSession, restoreDraftForSession } from "@/services/content-review";
import { editDraftForSession } from "@/services/content-draft-edits";
import { messageOf, scriptedModel } from "./cofounder-helpers";
import { approveDraft, draftAnswer, draftRow, editorForm, generatedDraftId, makeReadyForDrafts } from "./content-studio-helpers";
import { assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { makeWorkingPlan } from "./marketing-plan-helpers";

const EVERY_DRAFT = { status: "current", platform: "all" } as const;

// The values one CHECK of content_drafts allows, as Postgres writes it back
// ("... = ANY (ARRAY['a'::text, 'b'::text])").
async function checkListOf(constraintName: string): Promise<string[]> {
  const result = await db.execute<{ definition: string }>(
    sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'content_drafts'::regclass and conname = ${constraintName}`,
  );
  const definition = result.rows[0]?.definition ?? "";
  return [...definition.matchAll(/'([^']*)'::text/g)].map((match) => match[1]);
}

export async function runContentDraftChecks() {
  await check("content studio: another company can't list, count, read, edit, regenerate, approve, reject, archive or restore a company's drafts (services and /db)", async () => {
    const ownerA = sessionFor(await signUpTestOwner("studio-a"));
    const ownerB = sessionFor(await signUpTestOwner("studio-b"));
    await makeReadyForDrafts(ownerA);
    await makeReadyForDrafts(ownerB);
    const draftA = await generatedDraftId(ownerA, { platform: "linkedin", format: "post", topic: `A's lunch ${runId}`, pillar: "", campaign: "" });
    const before = await draftRow(draftA);

    assert.deepEqual(await listContentDraftsForSession(ownerB, 1, EVERY_DRAFT), []);
    assert.equal((await countContentDraftsPerStatus(ownerB.companyId, "all")).current, 0);
    assert.equal(await getContentDraftPageForSession(ownerB, draftA), null);
    assert.equal(await getContentDraftForCompany(ownerB.companyId, draftA), undefined);
    assert.deepEqual(await getContentDraftsForCompany(ownerB.companyId, EVERY_DRAFT, 1), []);
    const notFound = /couldn't find that draft/;
    assert.match(messageOf(await editDraftForSession(ownerB, await editorForm(draftA, { body: "B was here" }))), notFound);
    const model = scriptedModel([draftAnswer()]);
    assert.match(messageOf(await regenerateDraftForSession(ownerB, { draftId: draftA, version: "1" }, model.ask)), notFound);
    assert.equal(model.requests.length, 0, "Claude was asked for another company's draft");
    assert.match(messageOf(await approveDraftForSession(ownerB, { draftId: draftA, version: "1", claimsChecked: "on" })), notFound);
    assert.match(messageOf(await rejectDraftForSession(ownerB, { draftId: draftA, version: "1", note: "No" })), notFound);
    assert.match(messageOf(await archiveDraftForSession(ownerB, { draftId: draftA })), notFound);
    assert.match(messageOf(await restoreDraftForSession(ownerB, { draftId: draftA })), notFound);

    // /db: B's company (or B acting on A's company) finds nothing to change.
    const fields = { title: "", body: "B", hashtags: [], callToAction: "", imagePrompt: "", videoScript: "" };
    const placement = { topic: "B", pillar: "", campaign: "" };
    assert.equal(await editContentDraft(ownerB.companyId, ownerB.userId, { draftId: draftA, version: 1, placement, fields }), "not-found");
    assert.equal(await editContentDraft(ownerA.companyId, ownerB.userId, { draftId: draftA, version: 1, placement, fields }), "not-allowed");
    const generated = { fields, claims: [], factsUsed: [], knowledgeUsed: [], planVersion: null };
    assert.equal(await saveRegeneratedDraft(ownerB.companyId, ownerB.userId, { draftId: draftA, version: 1, generated }), "not-found");
    assert.deepEqual(await approveContentDraft(ownerB.companyId, ownerB.userId, { draftId: draftA, version: 1, claimsChecked: true }), { outcome: "not-found" });
    assert.deepEqual(await approveContentDraft(ownerA.companyId, ownerB.userId, { draftId: draftA, version: 1, claimsChecked: true }), { outcome: "not-allowed" });
    assert.equal(await rejectContentDraft(ownerB.companyId, ownerB.userId, { draftId: draftA, version: 1, note: null }), "not-found");
    assert.equal(await archiveContentDraft(ownerB.companyId, ownerB.userId, draftA), "not-found");
    assert.equal(await archiveContentDraft(ownerA.companyId, ownerB.userId, draftA), "not-allowed");
    assert.equal(await restoreContentDraft(ownerB.companyId, ownerB.userId, draftA), "not-found");
    assert.deepEqual(await draftRow(draftA), before);
    // A's own owner still reads and lists it.
    assert.equal((await getContentDraftPageForSession(ownerA, draftA.toUpperCase()))?.topic, `A's lunch ${runId}`);
    assert.deepEqual((await listContentDraftsForSession(ownerA, 1, EVERY_DRAFT)).map((draft) => draft.id), [draftA]);
  });

  await check("content studio: Postgres refuses a person or a plan version from another company, an approval of a version that moved on, a title off YouTube and a text post on YouTube", async () => {
    const ownerA = sessionFor(await signUpTestOwner("studio-db-a"));
    const ownerB = sessionFor(await signUpTestOwner("studio-db-b"));
    await makeReadyForDrafts(ownerA);
    await makeReadyForDrafts(ownerB);
    await makeWorkingPlan(ownerB);
    const draftId = await generatedDraftId(ownerA);
    const row = { companyId: ownerA.companyId, platform: "linkedin" as const, format: "post" as const, topic: "Raw", createdByUserId: ownerA.userId, updatedByUserId: ownerA.userId };
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, createdByUserId: ownerB.userId }), "content_drafts_creator_in_same_company_fk");
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, planVersion: 1 }), "content_drafts_plan_in_same_company_fk");
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, title: "A title" }), "content_drafts_title_youtube_only");
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, platform: "youtube" }), "content_drafts_youtube_takes_video");
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, status: "idea", body: "Text" }), "content_drafts_idea_has_no_content");
    const byId = eq(contentDrafts.id, draftId);
    // A whole approval (the CHECKs pass), by an owner of another company.
    const otherCompanysApproval = { status: "approved" as const, approvedByUserId: ownerB.userId, approvedAt: new Date(), approvedVersion: 1 };
    await assertRefusedByConstraint(db.update(contentDrafts).set(otherCompanysApproval).where(byId), "content_drafts_approver_in_same_company_fk");
    await assertRefusedByConstraint(db.update(contentDrafts).set({ status: "approved" }).where(byId), "content_drafts_approved_has_approval");
    assert.deepEqual(await approveDraft(ownerA, draftId, true), { ok: true });
    // An approved draft whose content moved on without clearing the approval can't exist.
    await assertRefusedByConstraint(db.update(contentDrafts).set({ version: 2 }).where(byId), "content_drafts_approved_has_approval");
    await assertRefusedByConstraint(db.update(contentDrafts).set({ status: "draft" }).where(byId), "content_drafts_unapproved_has_no_approval");
    await assertRefusedByConstraint(db.update(contentDrafts).set({ rejectionNote: "No" }).where(byId), "content_drafts_rejection_note_with_rejection");
    assert.equal((await draftRow(draftId)).status, "approved");
  });

  await check("content studio: the database's CHECKs list exactly the code's platforms, formats and statuses", async () => {
    assert.deepEqual((await checkListOf("content_drafts_platform_known")).sort(), [...socialPlatforms].sort());
    assert.deepEqual((await checkListOf("content_drafts_format_known")).sort(), [...contentFormats].sort());
    assert.deepEqual((await checkListOf("content_drafts_status_known")).sort(), [...contentDraftStatuses].sort());
  });

  await check("trusted fields: an edit carrying a company, status, version, approval, claims or another draft's id of its own writes only what the editor may change", async () => {
    const ownerA = sessionFor(await signUpTestOwner("studio-trusted-a"));
    const ownerB = sessionFor(await signUpTestOwner("studio-trusted-b"));
    await makeReadyForDrafts(ownerA);
    const draftId = await generatedDraftId(ownerA);
    const before = await draftRow(draftId);
    const smuggled = {
      companyId: ownerB.companyId,
      status: "approved",
      approvedByUserId: ownerA.userId,
      approvedVersion: "1",
      generatedVersion: "1",
      claims: [{ text: "x", supported: true, fact_topics: ["prices"] }],
      platform: "youtube",
      format: "video",
      createdByUserId: ownerB.userId,
    };
    const form = await editorForm(draftId, { ...smuggled, body: "Edited by hand." });
    assert.deepEqual(await editDraftForSession(ownerA, form), { ok: true });
    const after = await draftRow(draftId);
    assert.deepEqual(
      [after.companyId, after.status, after.version, after.generatedVersion, after.platform, after.format, after.createdByUserId, after.approvedByUserId],
      [ownerA.companyId, "draft", 2, 1, "linkedin", "post", ownerA.userId, null],
    );
    assert.deepEqual([after.body, after.claims], ["Edited by hand.", before.claims]);
  });
}
