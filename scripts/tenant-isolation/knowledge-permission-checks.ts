// Knowledge permission checks (step 34): members write and edit drafts, but
// can't approve, archive, restore, delete or change an approved article;
// owners can, and an owner made a member meanwhile no longer can (the role
// is read again, locked, in the transaction that writes); an edit or an
// approval of an article that changed since it was opened is refused; the
// fields' rules hold in Zod and in the database; a company keeps at most
// 1,000 articles; and writes and test searches have their own limits.

import assert from "node:assert/strict";
import { db } from "@/db/client";
import { changeKnowledgeArticleStatus } from "@/db/knowledge-status";
import { knowledgeArticles, knowledgeChunks } from "@/db/schema";
import type { FormResult } from "@/lib/form-result";
import { knowledgeKinds } from "@/lib/knowledge/kinds";
import { MAX_KNOWLEDGE_ARTICLES_PER_COMPANY } from "@/lib/knowledge/limits";
import { parseKnowledgeListQuery } from "@/lib/validation/list-queries";
import {
  countKnowledgeArticlesForSession,
  createKnowledgeArticleForSession,
  editKnowledgeArticleForSession,
  listKnowledgeArticlesForSession,
} from "@/services/knowledge";
import { testKnowledgeSearchForSession } from "@/services/knowledge-search";
import {
  approveKnowledgeArticleForSession,
  archiveKnowledgeArticleForSession,
  deleteKnowledgeArticleForSession,
  restoreKnowledgeArticleForSession,
} from "@/services/knowledge-status";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { changeTeammateRoleForSession } from "@/services/team";
import { addTeammate, assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { approveArticle, articleForm, articleRow, chunksOf, currentRevision, writeArticle } from "./knowledge-helpers";

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? JSON.stringify(result.errors.fieldErrors));
}

function editForm(articleId: string, revision: number, article: { title: string; body: string; marketing?: boolean }) {
  return { ...articleForm(article), articleId, revision: String(revision) };
}

export async function runKnowledgePermissionChecks() {
  await check("knowledge: members write and edit drafts, but can't approve, archive, restore, delete or change an approved article; owners can", async () => {
    const ownerUser = await signUpTestOwner("knowledge-roles");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "knowledge-member", "member"));
    const articleId = await writeArticle(member, { title: "Member draft", body: "First words." });
    assert.deepEqual(await editKnowledgeArticleForSession(member, editForm(articleId, 1, { title: "Member draft", body: "Better words." })), { ok: true });
    assert.match(messageOf(await approveKnowledgeArticleForSession(member, { articleId, revision: 2 })), /Only owners can approve/);
    assert.match(messageOf(await archiveKnowledgeArticleForSession(member, { articleId })), /Only owners can archive/);
    assert.match(messageOf(await deleteKnowledgeArticleForSession(member, { articleId })), /Only owners can delete/);
    // Straight to /db as the member: the role read there refuses too.
    assert.equal(await changeKnowledgeArticleStatus(member.companyId, member.userId, { articleId, to: "approve", revision: 2 }), "not-allowed");
    assert.equal((await articleRow(articleId)).status, "draft");

    await approveArticle(owner, articleId);
    assert.deepEqual([(await articleRow(articleId)).status, (await articleRow(articleId)).approvedByUserId], ["approved", owner.userId]);
    const approvedRevision = await currentRevision(owner, articleId);
    assert.match(messageOf(await editKnowledgeArticleForSession(member, editForm(articleId, approvedRevision, { title: "Member draft", body: "Sneaky." }))), /only owners change approved/);
    // The member can't change who it is for either (marketing ticked).
    assert.match(messageOf(await editKnowledgeArticleForSession(member, editForm(articleId, approvedRevision, { title: "Member draft", body: "Better words.", marketing: true }))), /only owners/);
    assert.deepEqual(await editKnowledgeArticleForSession(owner, editForm(articleId, approvedRevision, { title: "Owner's version", body: "Owner's words." })), { ok: true });
    const edited = await articleRow(articleId);
    assert.deepEqual([edited.status, edited.title, edited.approvedByUserId, edited.updatedByUserId], ["approved", "Owner's version", owner.userId, owner.userId]);

    assert.deepEqual(await archiveKnowledgeArticleForSession(owner, { articleId }), { ok: true });
    assert.match(messageOf(await editKnowledgeArticleForSession(owner, editForm(articleId, edited.revision, { title: "x", body: "y" }))), /restored first/);
    assert.match(messageOf(await restoreKnowledgeArticleForSession(member, { articleId })), /Only owners can restore/);
    assert.deepEqual(await restoreKnowledgeArticleForSession(owner, { articleId }), { ok: true });
    const restored = await articleRow(articleId);
    assert.deepEqual([restored.status, restored.approvedByUserId, restored.approvedAt], ["draft", null, null]);

    assert.deepEqual(await deleteKnowledgeArticleForSession(owner, { articleId }), { ok: true });
    assert.equal(await articleRow(articleId), undefined);
    assert.deepEqual(await chunksOf(articleId), [], "its pieces were left behind");
  });

  await check("knowledge: an owner made a member while their page is open can no longer approve (the role is read again in the transaction)", async () => {
    const ownerUser = await signUpTestOwner("knowledge-demoted");
    const otherOwner = await addTeammate(ownerUser, "knowledge-other-owner", "owner");
    const staleSession = sessionFor(otherOwner);
    const articleId = await writeArticle(sessionFor(ownerUser), { title: "Waiting for approval", body: "Text." });
    assert.deepEqual(await changeTeammateRoleForSession(sessionFor(ownerUser), { userId: otherOwner.id, role: "member" }), { ok: true });
    // The session still says "owner", as one read just before the change would.
    assert.match(messageOf(await approveKnowledgeArticleForSession(staleSession, { articleId, revision: 1 })), /Only owners can approve/);
    assert.match(messageOf(await deleteKnowledgeArticleForSession(staleSession, { articleId })), /Only owners can delete/);
    assert.equal((await articleRow(articleId)).status, "draft");
  });

  await check("knowledge: an edit or an approval of an article changed since it was opened is refused, and changes nothing", async () => {
    const ownerUser = await signUpTestOwner("knowledge-stale");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "knowledge-stale-member", "member"));
    const articleId = await writeArticle(member, { title: "Shared draft", body: "Version one." });
    // The owner opened revision 1; the member saves revision 2 meanwhile.
    assert.deepEqual(await editKnowledgeArticleForSession(member, editForm(articleId, 1, { title: "Shared draft", body: "Version two." })), { ok: true });
    assert.match(messageOf(await approveKnowledgeArticleForSession(owner, { articleId, revision: 1 })), /changed this draft after you opened it/);
    assert.match(messageOf(await editKnowledgeArticleForSession(owner, editForm(articleId, 1, { title: "Shared draft", body: "Owner's version one." }))), /changed this article after you opened it/);
    const row = await articleRow(articleId);
    assert.deepEqual([row.status, row.body, row.revision], ["draft", "Version two.", 2]);
    // Saving what is already stored changes nothing, not even the revision.
    assert.deepEqual(await editKnowledgeArticleForSession(member, editForm(articleId, 2, { title: "Shared draft", body: "Version two." })), { ok: true });
    assert.equal((await articleRow(articleId)).revision, 2);
  });

  await check("knowledge: a title is one plain line of 1-200, a text 1-20,000 (a line break counts once), a kind from the list", async () => {
    const owner = sessionFor(await signUpTestOwner("knowledge-fields"));
    const refusals = [
      { title: "", body: "x" },
      { title: "x".repeat(201), body: "x" },
      { title: "Fine", body: "  \n " },
      { title: "Fine", body: "x".repeat(20_001) },
      { title: "Fine", body: "Hidden \u0000 byte" },
    ];
    for (const article of refusals) {
      const result = await createKnowledgeArticleForSession(owner, articleForm(article));
      assert.ok(!result.ok && result.errors.fieldErrors, `accepted ${JSON.stringify(article).slice(0, 80)}`);
    }
    const unknownKind = await createKnowledgeArticleForSession(owner, { ...articleForm({ title: "Fine", body: "x" }), kind: "secret" });
    assert.ok(!unknownKind.ok && unknownKind.errors.fieldErrors?.kind);
    // 2,000 lines sent with \r\n: 19,999 characters as the box counts them.
    const lines = Array.from({ length: 2000 }, () => "y".repeat(9));
    const articleId = await writeArticle(owner, { title: "Line\nbreaks\u202Egone", body: lines.join("\r\n") });
    const row = await articleRow(articleId);
    assert.deepEqual([row.title, row.body], ["Line breaksgone", lines.join("\n")]);
  });

  await check("knowledge: the database refuses an unknown kind or status, an approval without an approver, a non-https source and an oversized piece", async () => {
    const ownerUser = await signUpTestOwner("knowledge-constraints");
    const row = { companyId: ownerUser.companyId, title: "Direct", body: "x", kind: "faq" as const, createdByUserId: ownerUser.id, updatedByUserId: ownerUser.id };
    // Every kind the forms offer is one the database takes.
    for (const kind of knowledgeKinds) {
      await db.insert(knowledgeArticles).values({ ...row, kind });
    }
    const unchecked = (values: Record<string, unknown>) => db.insert(knowledgeArticles).values({ ...row, ...values } as typeof row);
    await assertRefusedByConstraint(unchecked({ kind: "other" }), "knowledge_articles_kind_known");
    await assertRefusedByConstraint(unchecked({ status: "published" }), "knowledge_articles_status_known");
    await assertRefusedByConstraint(unchecked({ status: "approved" }), "knowledge_articles_approved_has_approver");
    await assertRefusedByConstraint(unchecked({ approvedByUserId: ownerUser.id, approvedAt: new Date() }), "knowledge_articles_draft_has_no_approver");
    await assertRefusedByConstraint(unchecked({ sourceUrl: "http://example.com/" }), "knowledge_articles_source_url_https");
    await assertRefusedByConstraint(unchecked({ title: "" }), "knowledge_articles_title_length");
    const [article] = await db.insert(knowledgeArticles).values(row).returning({ id: knowledgeArticles.id });
    await assertRefusedByConstraint(
      db.insert(knowledgeChunks).values({ companyId: ownerUser.companyId, articleId: article.id, position: 0, heading: "x", text: "z".repeat(1601) }),
      "knowledge_chunks_text_length",
    );
  });

  await check("knowledge: a company keeps at most 1,000 articles; one more is refused until one is deleted", async () => {
    const ownerUser = await signUpTestOwner("knowledge-cap");
    const owner = sessionFor(ownerUser);
    const rows = Array.from({ length: MAX_KNOWLEDGE_ARTICLES_PER_COMPANY - 1 }, (_, index) => ({
      companyId: ownerUser.companyId,
      title: `Earlier ${index}`,
      body: "x",
      kind: "faq" as const,
      createdByUserId: ownerUser.id,
      updatedByUserId: ownerUser.id,
    }));
    await db.insert(knowledgeArticles).values(rows);
    const lastOne = await writeArticle(owner, { title: "The thousandth", body: "Fits." });
    assert.match(messageOf(await createKnowledgeArticleForSession(owner, articleForm({ title: "One too many", body: "x" }))), /limit of 1,000 articles/);
    assert.deepEqual(await deleteKnowledgeArticleForSession(owner, { articleId: lastOne }), { ok: true });
    await writeArticle(owner, { title: "Room again", body: "Fits." });
  });

  await check("knowledge: writes count against their own limit, and so do test searches", async () => {
    const ownerUser = await signUpTestOwner("knowledge-limits");
    const busy = await addTeammate(ownerUser, "knowledge-busy", "member");
    for (let attempt = 0; attempt < RATE_LIMITS.knowledgeWritesPerUser.maxAttempts; attempt++) {
      await isOverRateLimit("knowledge-writes", busy.id, RATE_LIMITS.knowledgeWritesPerUser);
    }
    assert.match(messageOf(await createKnowledgeArticleForSession(sessionFor(busy), articleForm({ title: "One too many", body: "x" }))), /Too many changes/);
    for (let attempt = 0; attempt < RATE_LIMITS.knowledgeTestSearchesPerUser.maxAttempts; attempt++) {
      await isOverRateLimit("knowledge-test-searches", busy.id, RATE_LIMITS.knowledgeTestSearchesPerUser);
    }
    const searched = await testKnowledgeSearchForSession(sessionFor(busy), { question: "refunds" });
    assert.deepEqual(searched, { ok: false, errors: { message: "Too many searches. Wait a minute and try again." } });
    // Someone else in the company still searches.
    assert.ok((await testKnowledgeSearchForSession(sessionFor(ownerUser), { question: "refunds" })).ok);
  });

  await check("knowledge list: ?status= and ?q= fall back to every article, and the title search treats %, _ and \\ as plain text", async () => {
    for (const odd of [undefined, "secret", ["draft", "approved"], 42]) {
      assert.equal(parseKnowledgeListQuery({ status: odd }).status, "all");
    }
    assert.deepEqual(parseKnowledgeListQuery({ status: "draft", q: " 100% " }), { status: "draft", search: "100%" });
    const owner = sessionFor(await signUpTestOwner("knowledge-list"));
    await writeArticle(owner, { title: `100% refund ${runId}`, body: "x" });
    await writeArticle(owner, { title: `1000 refunds ${runId}`, body: "x" });
    const found = await listKnowledgeArticlesForSession(owner, 1, { status: "all", search: "100%" });
    assert.deepEqual(found.map((article) => article.title), [`100% refund ${runId}`]);
    assert.deepEqual(await countKnowledgeArticlesForSession(owner, "100%"), { all: 1, draft: 1, approved: 0, archived: 0 });
    assert.deepEqual(await listKnowledgeArticlesForSession(owner, 1, { status: "approved", search: null }), []);
  });
}
