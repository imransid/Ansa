// Content studio page checks (step 38): the list pages by 50, filters by
// status and platform with counts, and reads odd filters as the default;
// the draft page says what the AI wrote it from, who decided, and whether
// the text was changed by hand, and a refused approval refreshes it; and
// the fields' limits, as the boxes count them, with the database's CHECKs
// under them. A FAKE model only: nothing calls Anthropic.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db/client";
import { contentDrafts } from "@/db/schema";
import { DRAFT_BODY_MAX_LENGTH, DRAFT_TOPIC_MAX_LENGTH } from "@/lib/content-studio/limits";
import { PAGE_SIZE } from "@/lib/pagination";
import { parseContentDraftListQuery } from "@/lib/validation/list-queries";
import { countContentDraftsForSession, getContentDraftPageForSession, listContentDraftsForSession } from "@/services/content-drafts";
import { archiveDraftForSession } from "@/services/content-review";
import { messageOf, typeFact } from "./cofounder-helpers";
import { approveDraft, blankDraftId, draftAnswer, draftRow, editDraft, generatedDraftId, LINKEDIN_POST, makeReadyForDrafts } from "./content-studio-helpers";
import { assertRefusedByConstraint, check, sessionFor, signUpTestOwner } from "./helpers";
import { approvedArticle } from "./knowledge-helpers";
import { makeWorkingPlan } from "./marketing-plan-helpers";

export async function runContentStudioPageChecks() {
  await check("content studio: the list shows the newest changed first, 50 to a page, filtered by status (current = all but archived) and platform, each count on its link; odd filters read as the default", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-list"));
    await makeReadyForDrafts(owner);
    const xDraft = await generatedDraftId(owner, { platform: "x", format: "post", topic: "On X", pillar: "", campaign: "" });
    const approved = await generatedDraftId(owner);
    assert.deepEqual(await approveDraft(owner, approved, true), { ok: true });
    const archived = await blankDraftId(owner);
    assert.deepEqual(await archiveDraftForSession(owner, { draftId: archived }), { ok: true });
    for (let index = 0; index < PAGE_SIZE; index++) {
      await blankDraftId(owner, { ...LINKEDIN_POST, topic: `Idea ${index}` });
    }
    const current = { status: "current", platform: "all" } as const;
    const firstPage = await listContentDraftsForSession(owner, 1, current);
    const secondPage = await listContentDraftsForSession(owner, 2, current);
    assert.deepEqual([firstPage.length, secondPage.length], [PAGE_SIZE, 2]);
    assert.equal(firstPage[0].topic, `Idea ${PAGE_SIZE - 1}`);
    assert.ok(![...firstPage, ...secondPage].some((draft) => draft.id === archived));
    // The publishing queue's statuses (step 41) are counted too: none here.
    const queueStatuses = { scheduled: 0, published: 0, failed: 0 };
    assert.deepEqual(await countContentDraftsForSession(owner, "all"), { current: PAGE_SIZE + 2, idea: PAGE_SIZE, draft: 1, approved: 1, rejected: 0, ...queueStatuses, archived: 1 });
    assert.deepEqual(await countContentDraftsForSession(owner, "x"), { current: 1, idea: 0, draft: 1, approved: 0, rejected: 0, ...queueStatuses, archived: 0 });
    assert.deepEqual((await listContentDraftsForSession(owner, 1, { status: "current", platform: "x" })).map((draft) => draft.id), [xDraft]);
    assert.deepEqual((await listContentDraftsForSession(owner, 1, { status: "approved", platform: "all" })).map((draft) => draft.id), [approved]);
    assert.deepEqual((await listContentDraftsForSession(owner, 1, { status: "archived", platform: "all" })).map((draft) => draft.id), [archived]);
    assert.deepEqual(parseContentDraftListQuery({ status: "nope", platform: ["x", "facebook"] }), { status: "current", platform: "all" });
    assert.deepEqual(parseContentDraftListQuery({ status: "rejected", platform: "youtube" }), { status: "rejected", platform: "youtube" });
  });

  await check("content studio: a draft's page says what the AI wrote it from (facts as they were, articles, plan version), uses the confirmed business name, and knows when the text was changed by hand", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-page"));
    await makeReadyForDrafts(owner);
    await typeFact(owner, "company_name", "Bluebird Bakery");
    await makeWorkingPlan(owner);
    const article = await approvedArticle(owner, { title: "Weekday lunch menu", body: "Soup and a sandwich every weekday.", support: false, marketing: true });
    const draftId = await generatedDraftId(owner);
    const page = await getContentDraftPageForSession(owner, draftId);
    assert.ok(page, "its own company can't read the draft");
    assert.deepEqual(
      [page.madeFrom?.planVersion, page.madeFrom?.knowledge, page.madeFrom?.facts.map((fact) => fact.label), page.businessName, page.editedByHand],
      [1, [{ articleId: article, title: "Weekday lunch menu" }], ["Business name", "What the business does", "Products", "Target customers"], "Bluebird Bakery", false],
    );
    assert.deepEqual(page.planChoices, { planVersion: 1, pillars: ["Behind the oven", "Lunch ideas", "Neighbours"], campaigns: ["Lunch week"] });
    assert.deepEqual(await editDraft(owner, draftId, { body: "By hand." }), { ok: true });
    assert.equal((await getContentDraftPageForSession(owner, draftId))?.editedByHand, true);
    const blank = await getContentDraftPageForSession(owner, await blankDraftId(owner));
    assert.deepEqual([blank?.madeFrom, blank?.editedByHand, blank?.status, blank?.review.claimsState], [null, false, "idea", "written_by_hand"]);
    for (const badId of ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000"]) {
      assert.equal(await getContentDraftPageForSession(owner, badId), null, badId);
    }
  });

  await check("content studio: an approval refused for a fact changed after the page loaded refreshes the page, which then shows the claim not backed and the 'I checked these claims' box", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-refresh"));
    await makeReadyForDrafts(owner);
    const backedOnly = { claims: [{ text: "The bakery bakes sourdough bread in Lisbon.", fact_topics: ["description"] }] };
    const draftId = await generatedDraftId(owner, undefined, draftAnswer(backedOnly));
    // The page as it loaded: every claim backed, so no box to tick.
    assert.equal((await getContentDraftPageForSession(owner, draftId))?.review.acknowledgmentNeeded, false);
    await typeFact(owner, "description", "Bluebird Bakery bakes rye bread in Porto.");
    assert.match(messageOf(await approveDraft(owner, draftId, false)), /tick "I checked these claims"/);
    // What the refreshed page shows.
    const refreshed = (await getContentDraftPageForSession(owner, draftId))?.review;
    assert.deepEqual([refreshed?.acknowledgmentNeeded, refreshed?.claims.map((claim) => claim.status)], [true, ["fact_changed"]]);
    // The action refreshes the page whatever the outcome (refreshOrReturnErrors refreshes only on success).
    const actions = await readFile(path.join(process.cwd(), "app", "actions", "content-studio.ts"), "utf8");
    const approveAction = actions.slice(actions.indexOf("export async function approveDraftAction"), actions.indexOf("export async function rejectDraftAction"));
    assert.match(approveAction, /\n {2}refreshCoFounderPages\(\);\n/, "approveDraftAction no longer refreshes the page after a refusal");
    assert.ok(!approveAction.includes("refreshOrReturnErrors"));
  });

  await check("content studio: a draft's fields have their limits, a line break counting once as in the box; control characters, a bad hashtag or a missing topic are refused; the database's CHECKs hold", async () => {
    const owner = sessionFor(await signUpTestOwner("studio-fields"));
    const draftId = await blankDraftId(owner);
    const refused = async (changes: Record<string, unknown>, message: RegExp) => {
      assert.match(messageOf(await editDraft(owner, draftId, changes)), message, JSON.stringify(changes).slice(0, 80));
    };
    await refused({ topic: "   " }, /Say what the post is about/);
    await refused({ topic: "t".repeat(DRAFT_TOPIC_MAX_LENGTH + 1) }, /at most 500/);
    await refused({ body: "b".repeat(DRAFT_BODY_MAX_LENGTH + 1) }, /at most 63,206/);
    await refused({ body: "Bread\u0000" }, /control characters/);
    await refused({ hashtags: "#bread #café-bar" }, /Not a hashtag: #café-bar/);
    await refused({ hashtags: Array.from({ length: 31 }, (_, index) => `#tag${index}`).join(" ") }, /at most 30 hashtags/);
    assert.equal((await draftRow(draftId)).version, 1);
    // As the box counts: a line break is one character (a form sends \r\n), stored as \n.
    const fullBody = `${"b".repeat(DRAFT_BODY_MAX_LENGTH - 2)}\r\nb`;
    assert.deepEqual(await editDraft(owner, draftId, { body: fullBody }), { ok: true });
    const saved = await draftRow(draftId);
    assert.deepEqual([saved.body.length, saved.body.includes("\r"), saved.status], [DRAFT_BODY_MAX_LENGTH, false, "draft"]);
    assert.deepEqual(await editDraft(owner, draftId, { callToAction: "Order\nnow", hashtags: "bread, #Lisbon" }), { ok: true });
    assert.deepEqual([(await draftRow(draftId)).callToAction, (await draftRow(draftId)).hashtags], ["Order now", ["bread", "Lisbon"]]);

    const row = { companyId: owner.companyId, platform: "linkedin" as const, format: "post" as const, createdByUserId: owner.userId, updatedByUserId: owner.userId };
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, topic: "" }), "content_drafts_topic_length");
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, topic: "x", body: "b".repeat(63_207) }), "content_drafts_body_length");
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, topic: "x", hashtags: Array.from({ length: 31 }, () => "a") }), "content_drafts_hashtags_count");
    await assertRefusedByConstraint(db.insert(contentDrafts).values({ ...row, topic: "x", generatedVersion: 2 }), "content_drafts_generated_version_range");
  });
}
