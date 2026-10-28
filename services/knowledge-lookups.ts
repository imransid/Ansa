import "server-only";
import { getKnowledgeArticleTitles, getKnowledgeLookupsForCall } from "@/db/knowledge-lookups";
import { MAX_CALL_LOOKUPS_SHOWN } from "@/lib/knowledge/limits";
import type { SessionContext } from "@/lib/session";
import { callIdSchema } from "@/lib/validation/vapi";

// What the voice assistant looked up in the company's knowledge during a
// call (step 35), for the call page. The lookups themselves are recorded by
// services/vapi-tool-calls.ts while the call is live.

export type CallKnowledgeLookup = {
  id: string;
  at: Date;
  // The articles the answer held, best first; none = nothing was found.
  // A null title: the article was deleted since.
  articles: { articleId: string; title: string | null }[];
};

export type CallKnowledgeLookups = {
  // Oldest first, at most MAX_CALL_LOOKUPS_SHOWN.
  lookups: CallKnowledgeLookup[];
  moreNotShown: boolean;
};

// Lists the lookups made during one of the session company's calls, each with
// its articles' current titles, read within the company only. Nothing for a
// bad id or another company's call.
export async function listKnowledgeLookupsForCallForSession(session: SessionContext, callId: unknown): Promise<CallKnowledgeLookups> {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) {
    return { lookups: [], moreNotShown: false };
  }
  const rows = await getKnowledgeLookupsForCall(session.companyId, parsed.data);
  const shown = rows.slice(0, MAX_CALL_LOOKUPS_SHOWN);
  const articleIds = [...new Set(shown.flatMap((row) => row.articleIds))];
  const titles = await getKnowledgeArticleTitles(session.companyId, articleIds);
  return {
    lookups: shown.map((row) => ({
      id: row.id,
      at: row.createdAt,
      articles: row.articleIds.map((articleId) => ({ articleId, title: titles.get(articleId) ?? null })),
    })),
    moreNotShown: rows.length > MAX_CALL_LOOKUPS_SHOWN,
  };
}
