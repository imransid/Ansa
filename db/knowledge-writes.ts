import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import type { KnowledgeKind } from "@/lib/knowledge/kinds";
import { MAX_KNOWLEDGE_ARTICLES_PER_COMPANY } from "@/lib/knowledge/limits";
import { canEditKnowledgeArticle, canManageKnowledge } from "@/lib/knowledge/permissions";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { lockActiveAuthorRole } from "./knowledge-author";
import { rewriteArticleChunks } from "./knowledge-chunks";
import { companyDocuments, knowledgeArticles, tickets } from "./schema";

// Writing one company's knowledge articles (step 34): new drafts and edits,
// each with its pieces for the search rewritten in the SAME transaction.
// Approving, archiving, restoring and deleting: db/knowledge-status.ts. The
// person's role is read again, locked, in each (db/knowledge-author.ts).

export type KnowledgeArticleFields = {
  title: string;
  body: string;
  kind: KnowledgeKind;
  useForSupport: boolean;
  useForMarketing: boolean;
};

// Where new articles came from. A ticket number is only a claim (it comes
// from a URL): it becomes the source only when it names a solved ticket of
// this company. Imports (a document, a web page) are for owners only.
export type NewArticleSource =
  | { type: "none" }
  | { type: "ticket"; ticketNumber: number }
  | { type: "document"; documentId: string }
  | { type: "url"; url: string };

export type CreateArticlesOutcome =
  | { outcome: "created"; articleIds: string[] }
  // The person can't write here (removed, another company's, or a member importing).
  | { outcome: "refused" }
  // The company would pass MAX_KNOWLEDGE_ARTICLES_PER_COMPANY.
  | { outcome: "full" }
  // The document was deleted while its text was being read.
  | { outcome: "source-gone" };

// "stale": the article changed after the person opened it (another revision).
// "wrong-status": its status no longer fits the change (another owner changed
// it meanwhile), though the person may make that change.
export type ArticleChangeOutcome = "changed" | "unchanged" | "not-found" | "not-allowed" | "stale" | "wrong-status";

// Saves new draft articles of one company, written by actorUserId, with
// their pieces, all in one transaction (an import's parts all land, or none).
// WHY the company row is locked first: two saves at the same moment would
// otherwise both count 999 articles and both insert, past the cap. The lock
// makes them count one after the other (db/company-lock.ts: first, before
// the person's row).
export async function createKnowledgeArticles(
  companyId: string,
  actorUserId: string,
  articles: KnowledgeArticleFields[],
  source: NewArticleSource,
): Promise<CreateArticlesOutcome> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const isImport = source.type === "document" || source.type === "url";
    if (!role || (isImport && !canManageKnowledge(role))) {
      return { outcome: "refused" };
    }
    if ((await countArticles(tx, companyId)) + articles.length > MAX_KNOWLEDGE_ARTICLES_PER_COMPANY) {
      return { outcome: "full" };
    }
    const sourceColumns = await readSourceColumns(tx, companyId, source);
    if (!sourceColumns) {
      return { outcome: "source-gone" };
    }
    // Every column named, never a spread: a status, company or approver
    // can't ride along. New articles are always drafts.
    const rows = articles.map((article) => ({
      companyId,
      title: article.title,
      body: article.body,
      kind: article.kind,
      useForSupport: article.useForSupport,
      useForMarketing: article.useForMarketing,
      sourceDocumentId: sourceColumns.sourceDocumentId,
      sourceTicketId: sourceColumns.sourceTicketId,
      sourceUrl: sourceColumns.sourceUrl,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    }));
    const created = await tx
      .insert(knowledgeArticles)
      .values(rows)
      .returning({ id: knowledgeArticles.id, title: knowledgeArticles.title, body: knowledgeArticles.body });
    for (const article of created) {
      await rewriteArticleChunks(tx, companyId, article);
    }
    return { outcome: "created", articleIds: created.map((article) => article.id) };
  });
}

// Saves a person's edit of one article of one company, when they may edit
// it (lib/knowledge/permissions.ts) and nobody changed it since the revision
// they opened. An approved article stays approved, as approved by them: an
// owner's edit approves the new text. The pieces are rewritten when the
// title or body changed. Nothing different from what is stored = "unchanged".
export async function editKnowledgeArticle(
  companyId: string,
  actorUserId: string,
  edit: { articleId: string; revision: number; fields: KnowledgeArticleFields },
): Promise<ArticleChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const [current] = await tx
      .select({
        status: knowledgeArticles.status,
        revision: knowledgeArticles.revision,
        title: knowledgeArticles.title,
        body: knowledgeArticles.body,
        kind: knowledgeArticles.kind,
        useForSupport: knowledgeArticles.useForSupport,
        useForMarketing: knowledgeArticles.useForMarketing,
      })
      .from(knowledgeArticles)
      .where(and(eq(knowledgeArticles.companyId, companyId), eq(knowledgeArticles.id, edit.articleId)))
      .for("update");
    if (!current) {
      return "not-found";
    }
    if (!role || !canEditKnowledgeArticle(role, current.status)) {
      return "not-allowed";
    }
    if (current.revision !== edit.revision) {
      return "stale";
    }
    const fields = edit.fields;
    if (!differs(current, fields)) {
      return "unchanged";
    }
    const approval = current.status === "approved" ? { approvedByUserId: actorUserId, approvedAt: sql`now()` } : {};
    await tx
      .update(knowledgeArticles)
      .set({
        title: fields.title,
        body: fields.body,
        kind: fields.kind,
        useForSupport: fields.useForSupport,
        useForMarketing: fields.useForMarketing,
        revision: sql`${knowledgeArticles.revision} + 1`,
        updatedByUserId: actorUserId,
        updatedAt: sql`now()`,
        ...approval,
      })
      .where(and(eq(knowledgeArticles.companyId, companyId), eq(knowledgeArticles.id, edit.articleId)));
    if (fields.title !== current.title || fields.body !== current.body) {
      await rewriteArticleChunks(tx, companyId, { id: edit.articleId, title: fields.title, body: fields.body });
    }
    return "changed";
  });
}

async function countArticles(tx: DbTransaction, companyId: string): Promise<number> {
  const [row] = await tx.select({ articles: count() }).from(knowledgeArticles).where(eq(knowledgeArticles.companyId, companyId));
  return row?.articles ?? 0;
}

// The source columns of new articles, or null when their document is gone.
// The document's row is locked (FOR KEY SHARE): deleting it waits for these
// articles, then clears their reference (db/documents.ts).
async function readSourceColumns(tx: DbTransaction, companyId: string, source: NewArticleSource) {
  const none = { sourceDocumentId: null, sourceTicketId: null, sourceUrl: null };
  if (source.type === "url") {
    return { ...none, sourceUrl: source.url };
  }
  if (source.type === "ticket") {
    const [ticket] = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.companyId, companyId), eq(tickets.ticketNumber, source.ticketNumber), eq(tickets.status, "solved")));
    return { ...none, sourceTicketId: ticket?.id ?? null };
  }
  if (source.type === "document") {
    const [document] = await tx
      .select({ id: companyDocuments.id })
      .from(companyDocuments)
      .where(and(eq(companyDocuments.companyId, companyId), eq(companyDocuments.id, source.documentId)))
      .for("key share");
    return document ? { ...none, sourceDocumentId: document.id } : null;
  }
  return none;
}

function differs(current: KnowledgeArticleFields, fields: KnowledgeArticleFields): boolean {
  return (
    current.title !== fields.title ||
    current.body !== fields.body ||
    current.kind !== fields.kind ||
    current.useForSupport !== fields.useForSupport ||
    current.useForMarketing !== fields.useForMarketing
  );
}
