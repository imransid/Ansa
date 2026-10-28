// Shared pieces for the knowledge checks (step 34): writing and approving
// articles through the real services, and what the database holds for them.

import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { knowledgeArticles, knowledgeChunks } from "@/db/schema";
import type { KnowledgeKind } from "@/lib/knowledge/kinds";
import type { SessionContext } from "@/lib/session";
import { createKnowledgeArticleForSession, getKnowledgeArticleForSession } from "@/services/knowledge";
import { approveKnowledgeArticleForSession } from "@/services/knowledge-status";

type ArticleInput = {
  title: string;
  body: string;
  kind?: KnowledgeKind;
  support?: boolean;
  marketing?: boolean;
};

// What the article form sends: ticked checkboxes as "on", unticked ones not at all.
export function articleForm(article: ArticleInput): Record<string, unknown> {
  return {
    title: article.title,
    body: article.body,
    kind: article.kind ?? "faq",
    useForSupport: article.support === false ? null : "on",
    useForMarketing: article.marketing ? "on" : null,
  };
}

// Writes a draft as this person and returns its id.
export async function writeArticle(session: SessionContext, article: ArticleInput): Promise<string> {
  const result = await createKnowledgeArticleForSession(session, articleForm(article));
  if (!result.ok) {
    throw new Error(`Could not write the article: ${JSON.stringify(result.errors)}`);
  }
  return result.articleId;
}

// The revision the article's page shows now.
export async function currentRevision(session: SessionContext, articleId: string): Promise<number> {
  const article = await getKnowledgeArticleForSession(session, articleId);
  assert.ok(article, "the article is not readable by its own company");
  return article.revision;
}

// Approves an article as this owner, as its page shows it now.
export async function approveArticle(owner: SessionContext, articleId: string): Promise<void> {
  const result = await approveKnowledgeArticleForSession(owner, { articleId, revision: await currentRevision(owner, articleId) });
  assert.deepEqual(result, { ok: true });
}

// Writes and approves an article in one go, and returns its id.
export async function approvedArticle(owner: SessionContext, article: ArticleInput): Promise<string> {
  const articleId = await writeArticle(owner, article);
  await approveArticle(owner, articleId);
  return articleId;
}

// The article's row as the database holds it.
export async function articleRow(articleId: string) {
  const [row] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, articleId));
  return row;
}

// The article's pieces, in order.
export async function chunksOf(articleId: string) {
  return db
    .select({ heading: knowledgeChunks.heading, text: knowledgeChunks.text, companyId: knowledgeChunks.companyId })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.articleId, articleId))
    .orderBy(asc(knowledgeChunks.position));
}
