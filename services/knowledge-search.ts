import "server-only";
import { z } from "zod";
import { searchKnowledge } from "@/db/knowledge-search";
import type { FormErrors } from "@/lib/form-result";
import { buildCallAnswer } from "@/lib/knowledge/call-answer";
import type { KnowledgeKind } from "@/lib/knowledge/kinds";
import { buildKnowledgeSlice, KNOWLEDGE_HITS_FOR_AI, type KnowledgeSlice } from "@/lib/knowledge/prompt-slice";
import type { SessionContext } from "@/lib/session";
import { knowledgeQuestionSchema } from "@/lib/validation/knowledge";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Searching the company's approved knowledge (step 34): what the AI would get
// for a customer's question, and the articles related to a ticket.

// One approved support article that matches a ticket, with its best piece.
export type RelatedArticle = {
  articleId: string;
  title: string;
  kind: KnowledgeKind;
  text: string;
};

// "Test what the AI finds": the hits exactly as the AI would get them, and
// the one line the phone assistant would get during a call (step 35), or
// why not.
export type KnowledgeTestResult = { ok: true; slice: KnowledgeSlice; callAnswer: string } | { ok: false; errors: FormErrors };

// How many articles the ticket page lists.
const RELATED_ARTICLES_SHOWN = 3;

// Searches the session company's approved support articles for what a
// customer might ask, and returns them exactly as the AI would read them
// (lib/knowledge/prompt-slice.ts), and as the phone assistant would hear
// about them (lib/knowledge/call-answer.ts). Nothing is sent to any AI here.
export async function testKnowledgeSearchForSession(session: SessionContext, input: unknown): Promise<KnowledgeTestResult> {
  const parsed = knowledgeQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("knowledge-test-searches", session.userId, RATE_LIMITS.knowledgeTestSearchesPerUser)) {
    return { ok: false, errors: { message: "Too many searches. Wait a minute and try again." } };
  }
  const hits = await searchKnowledge(session.companyId, { query: parsed.data.question, audience: "support", limit: KNOWLEDGE_HITS_FOR_AI });
  return {
    ok: true,
    slice: buildKnowledgeSlice(hits.map((hit) => ({ title: hit.title, text: hit.text }))),
    // WHY the same hits do: the search ranks the same whatever its limit, and
    // the call's answer keeps the best CALL_ANSWER_MAX_HITS (fewer than these).
    callAnswer: buildCallAnswer(hits).text,
  };
}

// Lists up to 3 of the session company's approved support articles that
// match a ticket's subject and category name, each with its best piece, for
// the ticket page. The team sees them; nothing reaches the customer.
export async function listRelatedKnowledgeForTicketForSession(
  session: SessionContext,
  ticket: { subject: string; category: string | null },
): Promise<RelatedArticle[]> {
  const query = [ticket.subject, ticket.category ?? ""].join(" ");
  const hits = await searchKnowledge(session.companyId, { query, audience: "support", limit: 10 });
  const related: RelatedArticle[] = [];
  for (const hit of hits) {
    // Best first, so the first hit of an article is its best piece.
    if (!related.some((article) => article.articleId === hit.articleId)) {
      related.push({ articleId: hit.articleId, title: hit.title, kind: hit.kind, text: hit.text });
    }
  }
  return related.slice(0, RELATED_ARTICLES_SHOWN);
}
