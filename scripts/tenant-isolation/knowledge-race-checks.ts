// Knowledge race checks (step 34): what happens when people act on the same
// company's knowledge at the same moment. Saves at once can't pass the
// 1,000-article cap (the company row is locked before counting), and an
// owner whose page is out of date is told the article's status changed
// meanwhile, not that only owners may do it.

import assert from "node:assert/strict";
import { count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { changeKnowledgeArticleStatus } from "@/db/knowledge-status";
import { knowledgeArticles } from "@/db/schema";
import { MAX_KNOWLEDGE_ARTICLES_PER_COMPANY } from "@/lib/knowledge/limits";
import { createKnowledgeArticleForSession, companyFullMessage } from "@/services/knowledge";
import { approveKnowledgeArticleForSession, archiveKnowledgeArticleForSession, restoreKnowledgeArticleForSession } from "@/services/knowledge-status";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";
import { approveArticle, approvedArticle, articleForm, articleRow, currentRevision, writeArticle } from "./knowledge-helpers";

export async function runKnowledgeRaceChecks() {
  await check("knowledge: five articles saved at the same moment, with room for two, make exactly two (the cap holds under a race)", async () => {
    const ownerUser = await signUpTestOwner("knowledge-cap-race");
    const owner = sessionFor(ownerUser);
    const member = sessionFor(await addTeammate(ownerUser, "knowledge-cap-race-member", "member"));
    const rows = Array.from({ length: MAX_KNOWLEDGE_ARTICLES_PER_COMPANY - 2 }, (_, index) => ({
      companyId: ownerUser.companyId,
      title: `Earlier ${index}`,
      body: "x",
      kind: "faq" as const,
      createdByUserId: ownerUser.id,
      updatedByUserId: ownerUser.id,
    }));
    await db.insert(knowledgeArticles).values(rows);
    const writers = [owner, member, owner, member, owner];
    const results = await Promise.all(writers.map((writer, index) => createKnowledgeArticleForSession(writer, articleForm({ title: `At once ${index}`, body: "x" }))));
    const refusals = results.filter((result) => !result.ok);
    assert.equal(results.length - refusals.length, 2, "not exactly two were saved");
    assert.ok(refusals.every((result) => result.errors.message === companyFullMessage()), JSON.stringify(refusals));
    const [stored] = await db.select({ articles: count() }).from(knowledgeArticles).where(eq(knowledgeArticles.companyId, ownerUser.companyId));
    assert.equal(stored.articles, MAX_KNOWLEDGE_ARTICLES_PER_COMPANY);
  });

  await check("knowledge: an owner's out-of-date page is told the status changed meanwhile (restore after another owner restored and approved, approve after another archived)", async () => {
    const ownerUser = await signUpTestOwner("knowledge-meanwhile");
    const owner = sessionFor(ownerUser);
    const otherOwner = sessionFor(await addTeammate(ownerUser, "knowledge-meanwhile-owner", "owner"));
    // Both have the archived article's page open; the other owner restores and approves it.
    const archived = await approvedArticle(owner, { title: "Seasonal opening hours", body: "Closed on Sundays." });
    assert.deepEqual(await archiveKnowledgeArticleForSession(owner, { articleId: archived }), { ok: true });
    assert.deepEqual(await restoreKnowledgeArticleForSession(otherOwner, { articleId: archived }), { ok: true });
    await approveArticle(otherOwner, archived);
    const restoreAgain = await restoreKnowledgeArticleForSession(owner, { articleId: archived });
    assert.deepEqual(restoreAgain, { ok: false, errors: { message: "This article is no longer archived: someone restored it meanwhile. Reload the page to see it." } });
    assert.equal(await changeKnowledgeArticleStatus(owner.companyId, owner.userId, { articleId: archived, to: "restore", revision: null }), "wrong-status");
    assert.deepEqual([(await articleRow(archived)).status, (await articleRow(archived)).approvedByUserId], ["approved", otherOwner.userId]);
    // A draft page open; the other owner archives the draft meanwhile.
    const draft = await writeArticle(owner, { title: "Gift wrapping", body: "Free for orders over 50." });
    const revisionOnPage = await currentRevision(owner, draft);
    assert.deepEqual(await archiveKnowledgeArticleForSession(otherOwner, { articleId: draft }), { ok: true });
    const approveLate = await approveKnowledgeArticleForSession(owner, { articleId: draft, revision: revisionOnPage });
    assert.deepEqual(approveLate, { ok: false, errors: { message: "This article was archived meanwhile. Reload the page: restore it as a draft first, then approve it." } });
    assert.equal((await articleRow(draft)).status, "archived");
    // A member still hears that only owners may do it.
    const member = sessionFor(await addTeammate(ownerUser, "knowledge-meanwhile-member", "member"));
    assert.deepEqual(await restoreKnowledgeArticleForSession(member, { articleId: draft }), { ok: false, errors: { message: "Only owners can restore articles." } });
  });
}
