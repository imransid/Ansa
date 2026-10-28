// Knowledge base checks (step 34): one company can't list, read, search,
// edit, approve, archive, restore or delete another's articles, through the
// services or straight through /db; the database itself refuses pieces,
// people and sources from another company; the search returns approved
// articles meant for the audience only (never drafts or archived ones), at
// most 2 pieces per article and 10 hits; and the pieces follow every change
// to the title and the text.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getKnowledgeArticleForCompany, getKnowledgeArticlesForCompany } from "@/db/knowledge-articles";
import { searchKnowledge } from "@/db/knowledge-search";
import { changeKnowledgeArticleStatus, deleteKnowledgeArticle } from "@/db/knowledge-status";
import { editKnowledgeArticle } from "@/db/knowledge-writes";
import { knowledgeArticles, knowledgeChunks } from "@/db/schema";
import { NOTHING_FOUND_ANSWER } from "@/lib/knowledge/call-answer";
import {
  createKnowledgeArticleForSession,
  editKnowledgeArticleForSession,
  getKnowledgeArticleForSession,
  listKnowledgeArticlesForSession,
} from "@/services/knowledge";
import { testKnowledgeSearchForSession } from "@/services/knowledge-search";
import {
  approveKnowledgeArticleForSession,
  archiveKnowledgeArticleForSession,
  deleteKnowledgeArticleForSession,
  restoreKnowledgeArticleForSession,
} from "@/services/knowledge-status";
import type { SessionContext } from "@/lib/session";
import { assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { approvedArticle, articleForm, articleRow, chunksOf, currentRevision, writeArticle } from "./knowledge-helpers";

const NOT_FOUND = { ok: false, errors: { message: "That article was not found in your company." } };

export async function runKnowledgeChecks(ownerA: TestUser, ownerB: TestUser) {
  const asOwnerA = sessionFor(ownerA);
  const asOwnerB = sessionFor(ownerB);

  await check("knowledge: a new article is a draft of the session's company by the session's user; a smuggled company, status or approver is ignored", async () => {
    const smuggled = { ...articleForm({ title: `Opening hours ${runId}`, body: "Monday to Friday, 9 to 5." }), companyId: ownerB.companyId, status: "approved", approvedByUserId: ownerA.id };
    const created = await createKnowledgeArticleForSession(asOwnerA, smuggled);
    assert.ok(created.ok, JSON.stringify(created));
    const row = await articleRow(created.articleId);
    assert.deepEqual(
      [row.companyId, row.status, row.createdByUserId, row.updatedByUserId, row.approvedByUserId, row.revision, row.useForSupport, row.useForMarketing],
      [ownerA.companyId, "draft", ownerA.id, ownerA.id, null, 1, true, false],
    );
  });

  await check("knowledge: another company can't list, read, search, edit, approve, archive, restore or delete an article (services and /db)", async () => {
    const marker = `zebracode${runId.replace(/\W/g, "")}`;
    const articleId = await approvedArticle(asOwnerA, { title: `Returns ${marker}`, body: `How returns work ${marker}.` });
    const before = await articleRow(articleId);
    assert.ok(!(await listKnowledgeArticlesForSession(asOwnerB)).some((article) => article.id === articleId));
    assert.equal(await getKnowledgeArticleForSession(asOwnerB, articleId), null);
    assert.deepEqual(await testKnowledgeSearchForSession(asOwnerB, { question: marker }), { ok: true, slice: { hits: [], text: "" }, callAnswer: NOTHING_FOUND_ANSWER });
    assert.deepEqual(await searchKnowledge(ownerB.companyId, { query: marker, audience: "support", limit: 10 }), []);
    const edit = { ...articleForm({ title: "Taken over", body: "Not yours" }), articleId, revision: String(before.revision) };
    assert.deepEqual(await editKnowledgeArticleForSession(asOwnerB, edit), NOT_FOUND);
    assert.deepEqual(await approveKnowledgeArticleForSession(asOwnerB, { articleId, revision: before.revision }), NOT_FOUND);
    assert.deepEqual(await archiveKnowledgeArticleForSession(asOwnerB, { articleId }), NOT_FOUND);
    assert.deepEqual(await restoreKnowledgeArticleForSession(asOwnerB, { articleId }), NOT_FOUND);
    assert.deepEqual(await deleteKnowledgeArticleForSession(asOwnerB, { articleId }), NOT_FOUND);
    // Straight to /db with B's company: nothing is found, so nothing changes.
    const fields = { title: "Taken over", body: "Not yours", kind: "faq" as const, useForSupport: true, useForMarketing: true };
    assert.equal(await editKnowledgeArticle(ownerB.companyId, ownerB.id, { articleId, revision: before.revision, fields }), "not-found");
    assert.equal(await changeKnowledgeArticleStatus(ownerB.companyId, ownerB.id, { articleId, to: "archive", revision: null }), "not-found");
    assert.equal(await deleteKnowledgeArticle(ownerB.companyId, ownerB.id, articleId), "not-found");
    assert.equal(await getKnowledgeArticleForCompany(ownerB.companyId, articleId), undefined);
    const bList = await getKnowledgeArticlesForCompany(ownerB.companyId, { status: "all", search: marker }, 1);
    assert.deepEqual(bList, []);
    // A's own company still finds it, unchanged.
    assert.deepEqual(await articleRow(articleId), before);
    const own = await searchKnowledge(ownerA.companyId, { query: marker, audience: "support", limit: 10 });
    assert.deepEqual(own.map((hit) => hit.articleId), [articleId]);
  });

  await check("knowledge: the database refuses a piece, a person or a source from another company", async () => {
    const articleId = await writeArticle(asOwnerA, { title: `Database guard ${runId}`, body: "Guarded." });
    await assertRefusedByConstraint(
      db.insert(knowledgeChunks).values({ companyId: ownerB.companyId, articleId, position: 9, heading: "x", text: "Moved across" }),
      "knowledge_chunks_article_in_same_company_fk",
    );
    const row = { companyId: ownerA.companyId, title: "Cross", body: "x", kind: "faq" as const, updatedByUserId: ownerA.id };
    await assertRefusedByConstraint(db.insert(knowledgeArticles).values({ ...row, createdByUserId: ownerB.id }), "knowledge_articles_creator_in_same_company_fk");
    await assertRefusedByConstraint(
      db.insert(knowledgeArticles).values({ ...row, createdByUserId: ownerA.id, sourceTicketId: randomUUID() }),
      "knowledge_articles_ticket_in_same_company_fk",
    );
    await assertRefusedByConstraint(
      db.insert(knowledgeArticles).values({ ...row, createdByUserId: ownerA.id, sourceDocumentId: randomUUID() }),
      "knowledge_articles_document_in_same_company_fk",
    );
  });

  await check("knowledge search: approved articles meant for the audience only, never drafts or archived ones", async () => {
    const owner = sessionFor(await signUpTestOwner("knowledge-audience"));
    const word = `quokka${runId.replace(/\W/g, "")}`;
    const support = await approvedArticle(owner, { title: `Support ${word}`, body: `Support text ${word}.` });
    const marketing = await approvedArticle(owner, { title: `Marketing ${word}`, body: `Marketing text ${word}.`, support: false, marketing: true });
    const both = await approvedArticle(owner, { title: `Both ${word}`, body: `Both text ${word}.`, marketing: true });
    await writeArticle(owner, { title: `Draft ${word}`, body: `Draft text ${word}.`, marketing: true });
    const archived = await approvedArticle(owner, { title: `Archived ${word}`, body: `Archived text ${word}.`, marketing: true });
    assert.deepEqual(await archiveKnowledgeArticleForSession(owner, { articleId: archived }), { ok: true });
    const found = async (audience: "support" | "marketing") =>
      (await searchKnowledge(owner.companyId, { query: word, audience, limit: 10 })).map((hit) => hit.articleId).sort();
    assert.deepEqual(await found("support"), [support, both].sort());
    assert.deepEqual(await found("marketing"), [marketing, both].sort());
  });

  await check("knowledge search: at most 2 pieces of one article and 10 hits, best first, each naming its article", async () => {
    const owner = sessionFor(await signUpTestOwner("knowledge-bounds"));
    const word = `wombat${runId.replace(/\W/g, "")}`;
    // Five pieces, each holding the word.
    const longBody = Array.from({ length: 5 }, (_, index) => `Part ${index} ${word} ${"filler ".repeat(200)}`).join("\n\n");
    const longArticle = await approvedArticle(owner, { title: "Long article", body: longBody });
    assert.equal((await chunksOf(longArticle)).length, 5);
    for (let index = 0; index < 12; index++) {
      await approvedArticle(owner, { title: `Short ${index}`, body: `${word} short ${index}` });
    }
    const hits = await searchKnowledge(owner.companyId, { query: word, audience: "support", limit: 50 });
    assert.equal(hits.length, 10);
    assert.ok(hits.filter((hit) => hit.articleId === longArticle).length <= 2);
    assert.ok(hits.every((hit, index) => index === 0 || hits[index - 1].rank >= hit.rank), "hits are not best first");
    assert.ok(hits.every((hit) => hit.title && hit.text.includes(word)));
    // A title word counts most (weight A): the article with it in its title comes first.
    const titled = await approvedArticle(owner, { title: `Titled ${word}`, body: "Nothing else here." });
    const [best] = await searchKnowledge(owner.companyId, { query: `${word} titled`, audience: "support", limit: 3 });
    assert.equal(best.articleId, titled);
    assert.deepEqual(await searchKnowledge(owner.companyId, { query: "the and how", audience: "support", limit: 5 }), []);
  });

  await check("knowledge search: accents and capitals don't matter (ICU lower-casing, whatever the database's locale), and words find longer ones", async () => {
    const owner = sessionFor(await signUpTestOwner("knowledge-accents"));
    const articleId = await approvedArticle(owner, { title: `ÉTAT DES RETOURS ${runId}`, body: "Remboursements sous quatorze jours. Straße." });
    // "ＲＥＴＯＵＲＳ" is written in full-width letters: NFKC makes it "RETOURS".
    for (const question of ["état", "État des retours", "remboursement", "STRASSE straße", "ＲＥＴＯＵＲＳ"]) {
      const hits = await searchKnowledge(owner.companyId, { query: question, audience: "support", limit: 5 });
      assert.deepEqual(hits.map((hit) => hit.articleId), [articleId], `"${question}" was not found`);
    }
  });

  await check("knowledge: the pieces follow every edit of the text and the title, never empty or over 1,500 characters", async () => {
    const owner = sessionFor(await signUpTestOwner("knowledge-chunks"));
    const body = ["a".repeat(700), "b".repeat(700), "c".repeat(700)].join("\n\n");
    const articleId = await approvedArticle(owner, { title: `Old title ${runId}`, body });
    const search = async (query: string) => (await searchKnowledge(owner.companyId, { query, audience: "support", limit: 5 })).length;
    assert.equal(await search("aaaaaaaaaa"), 1);
    assert.deepEqual((await chunksOf(articleId)).map((piece) => [piece.heading, piece.text]), [
      [`Old title ${runId}`, `${"a".repeat(700)}\n\n${"b".repeat(700)}`],
      [`Old title ${runId}`, "c".repeat(700)],
    ]);
    await saveEdit(owner, articleId, { title: `Fresh headline ${runId}`, body: "One short paragraph now." });
    assert.deepEqual((await chunksOf(articleId)).map((piece) => [piece.heading, piece.text, piece.companyId]), [
      [`Fresh headline ${runId}`, "One short paragraph now.", owner.companyId],
    ]);
    assert.equal(await search("headline"), 1);
    assert.equal(await search("aaaaaaaaaa"), 0, "the old text is still searched");
    await saveEdit(owner, articleId, { title: `Fresh headline ${runId}`, body: `${"word ".repeat(1000)}end.` });
    const pieces = await chunksOf(articleId);
    assert.ok(pieces.length === 4 && pieces.every((piece) => piece.text.length > 0 && piece.text.length <= 1500 && piece.text === piece.text.trim()));
    // The title alone: every piece's heading follows, and the search with it.
    await saveEdit(owner, articleId, { title: `Renamed ${runId}`, body: `${"word ".repeat(1000)}end.` });
    const renamed = await chunksOf(articleId);
    assert.deepEqual(renamed.map((piece) => [piece.heading, piece.text]), pieces.map((piece) => [`Renamed ${runId}`, piece.text]));
    assert.ok((await search("renamed")) > 0, "the new title is not searched");
    assert.equal(await search("headline"), 0, "the old title is still searched");
    const row = await articleRow(articleId);
    assert.deepEqual([row.status, row.approvedByUserId], ["approved", owner.userId]);
  });
}

// The indexes the Knowledge list and the search need (step 34).
const KNOWLEDGE_INDEXES: Record<string, string> = {
  knowledge_articles_company_id_status_updated_at_idx: "(company_id, status, updated_at)",
  knowledge_articles_company_id_updated_at_idx: "(company_id, updated_at)",
  knowledge_chunks_search_vector_idx: "USING gin (search_vector)",
};

export async function runKnowledgeIndexChecks() {
  await check("knowledge: the list and the search have their indexes", async () => {
    const result = await db.execute<{ indexname: string; indexdef: string }>(sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`);
    const definitions = new Map(result.rows.map((row) => [row.indexname, row.indexdef]));
    for (const [name, part] of Object.entries(KNOWLEDGE_INDEXES)) {
      assert.ok(definitions.get(name)?.includes(part), `${name}: ${definitions.get(name) ?? "missing, run pnpm db:migrate"}`);
    }
  });
}

// Saves an edit as the article's page would send it, and checks it worked.
async function saveEdit(session: SessionContext, articleId: string, article: { title: string; body: string }) {
  const revision = await currentRevision(session, articleId);
  const result = await editKnowledgeArticleForSession(session, { ...articleForm(article), articleId, revision: String(revision) });
  assert.deepEqual(result, { ok: true });
}
