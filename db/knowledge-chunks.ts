import "server-only";
import { and, count, eq } from "drizzle-orm";
import { chunkArticleBody } from "@/lib/knowledge/chunking";
import { db, type DbTransaction } from "./client";
import { knowledgeChunks } from "./schema";

// The pieces the knowledge search reads (step 34). Written ONLY by the
// transaction that writes the article's title or body (db/knowledge-writes.ts),
// so the search never finds text the article no longer holds.

// Replaces one article's pieces with new ones cut from its body, each headed
// by its title, inside the caller's transaction.
export async function rewriteArticleChunks(
  tx: DbTransaction,
  companyId: string,
  article: { id: string; title: string; body: string },
): Promise<void> {
  await tx.delete(knowledgeChunks).where(and(eq(knowledgeChunks.companyId, companyId), eq(knowledgeChunks.articleId, article.id)));
  const pieces = chunkArticleBody(article.body);
  if (pieces.length === 0) {
    return;
  }
  // Every column named: search_vector is made by Postgres from heading and text.
  const rows = pieces.map((text, position) => ({ companyId, articleId: article.id, position, heading: article.title, text }));
  await tx.insert(knowledgeChunks).values(rows);
}

// How many pieces one article of one company has, for its page.
export async function countArticleChunks(companyId: string, articleId: string): Promise<number> {
  const [row] = await db
    .select({ pieces: count() })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.companyId, companyId), eq(knowledgeChunks.articleId, articleId)));
  return row?.pieces ?? 0;
}
