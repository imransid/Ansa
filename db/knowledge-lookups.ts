import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { MAX_CALL_LOOKUPS_SHOWN } from "@/lib/knowledge/limits";
import { db } from "./client";
import { calls, knowledgeArticles, knowledgeLookups } from "./schema";

// What the voice assistant looked up in the company's knowledge during a
// live call (step 35): article ids and hit counts only, never the question.

export type KnowledgeLookupRow = {
  id: string;
  createdAt: Date;
  articleIds: string[];
  hitCount: number;
};

// Records one search made during a call on one of the company's lines.
export async function recordKnowledgeLookup(
  companyId: string,
  lookup: { vapiCallId: string; articleIds: string[]; hitCount: number },
): Promise<void> {
  await db.insert(knowledgeLookups).values({
    companyId,
    vapiCallId: lookup.vapiCallId,
    articleIds: lookup.articleIds,
    hitCount: lookup.hitCount,
  });
}

// The lookups made during one of the company's calls, oldest first: the
// first MAX_CALL_LOOKUPS_SHOWN, and one more to know there are more. Both
// tables are matched on the company: a lookup another company recorded
// under the same Vapi id never shows.
export async function getKnowledgeLookupsForCall(companyId: string, callId: string): Promise<KnowledgeLookupRow[]> {
  return db
    .select({
      id: knowledgeLookups.id,
      createdAt: knowledgeLookups.createdAt,
      articleIds: knowledgeLookups.articleIds,
      hitCount: knowledgeLookups.hitCount,
    })
    .from(knowledgeLookups)
    .innerJoin(calls, and(eq(calls.vapiCallId, knowledgeLookups.vapiCallId), eq(calls.companyId, knowledgeLookups.companyId)))
    .where(and(eq(knowledgeLookups.companyId, companyId), eq(calls.companyId, companyId), eq(calls.id, callId)))
    .orderBy(asc(knowledgeLookups.createdAt), asc(knowledgeLookups.id))
    .limit(MAX_CALL_LOOKUPS_SHOWN + 1);
}

// The titles of those of the company's articles that still exist, by id.
// An id missing from the result was deleted (or was never this company's).
export async function getKnowledgeArticleTitles(companyId: string, articleIds: string[]): Promise<Map<string, string>> {
  if (articleIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: knowledgeArticles.id, title: knowledgeArticles.title })
    .from(knowledgeArticles)
    .where(and(eq(knowledgeArticles.companyId, companyId), inArray(knowledgeArticles.id, articleIds)));
  return new Map(rows.map((row) => [row.id, row.title]));
}
