import "server-only";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { KnowledgeAudience, KnowledgeKind } from "@/lib/knowledge/kinds";
import { buildKnowledgeTsQuery } from "@/lib/knowledge/search-query";
import { db } from "./client";
import { knowledgeArticles, knowledgeChunks } from "./schema";

// The knowledge search (step 34): Postgres full-text search over one
// company's APPROVED articles meant for one audience, never drafts or
// archived ones. Every hit names its article, so whoever reads it (a
// teammate, later the AI) knows where it came from.

export type KnowledgeHit = {
  articleId: string;
  title: string;
  kind: KnowledgeKind;
  // The matching piece of the article (at most 1,500 characters).
  text: string;
  rank: number;
};

// The most hits one search returns, and pieces of one article among them:
// two pieces of the same article still leave room for others.
const MAX_HITS = 10;
const MAX_PIECES_PER_ARTICLE = 2;

// Searches one company's approved articles for the audience asked for, best
// first (ts_rank_cd: how many of the words, how close together, title words
// counting most). The text is what someone asked: its words are cleaned
// (lib/knowledge/search-query.ts) and passed to to_tsquery as a parameter.
// No usable word = no search, no hits.
export async function searchKnowledge(
  companyId: string,
  request: { query: string; audience: KnowledgeAudience; limit: number },
): Promise<KnowledgeHit[]> {
  const tsQueryText = buildKnowledgeTsQuery(request.query);
  if (!tsQueryText) {
    return [];
  }
  const tsQuery = sql`to_tsquery('simple', ${tsQueryText})`;
  const rank = sql<number>`ts_rank_cd(${knowledgeChunks.searchVector}, ${tsQuery})`;
  const audienceFlag = request.audience === "support" ? knowledgeArticles.useForSupport : knowledgeArticles.useForMarketing;
  const ranked = db
    .select({
      articleId: knowledgeChunks.articleId,
      title: knowledgeArticles.title,
      kind: knowledgeArticles.kind,
      text: knowledgeChunks.text,
      position: knowledgeChunks.position,
      rank: rank.as("rank"),
      placeInArticle: sql<number>`row_number() over (partition by ${knowledgeChunks.articleId} order by ${rank} desc, ${knowledgeChunks.position})`.as(
        "place_in_article",
      ),
    })
    .from(knowledgeChunks)
    .innerJoin(
      knowledgeArticles,
      and(eq(knowledgeArticles.id, knowledgeChunks.articleId), eq(knowledgeArticles.companyId, knowledgeChunks.companyId)),
    )
    .where(
      and(
        // The company first, on both tables.
        eq(knowledgeChunks.companyId, companyId),
        eq(knowledgeArticles.companyId, companyId),
        eq(knowledgeArticles.status, "approved"),
        eq(audienceFlag, true),
        sql`${knowledgeChunks.searchVector} @@ ${tsQuery}`,
      ),
    )
    .as("ranked");

  const hits = await db
    .select({ articleId: ranked.articleId, title: ranked.title, kind: ranked.kind, text: ranked.text, rank: ranked.rank })
    .from(ranked)
    .where(lte(ranked.placeInArticle, MAX_PIECES_PER_ARTICLE))
    .orderBy(desc(ranked.rank), asc(ranked.articleId), asc(ranked.position))
    .limit(hitLimit(request.limit));
  return hits.map((hit) => ({ ...hit, rank: Number(hit.rank) }));
}

// Between 1 and 10, whatever the caller asked for.
function hitLimit(asked: number): number {
  return Number.isInteger(asked) ? Math.min(Math.max(1, asked), MAX_HITS) : MAX_HITS;
}
