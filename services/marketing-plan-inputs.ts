import "server-only";
import { getSupportTrendsSetting } from "@/db/cofounder-settings";
import { searchKnowledge } from "@/db/knowledge-search";
import { getNewestPerformanceReview } from "@/db/performance-reviews";
import { countRecentTicketsPerCategory } from "@/db/support-trends";
import { businessFactTopics, type BusinessFactTopic } from "@/lib/business-facts";
import { buildKnowledgeSlice } from "@/lib/knowledge/prompt-slice";
import { combineSearchTexts } from "@/lib/knowledge/search-query";
import { PLAN_KNOWLEDGE_HITS, SUPPORT_TREND_CATEGORIES_MAX, SUPPORT_TREND_DAYS } from "@/lib/marketing-plan/limits";
import type { ConfirmedFact, PlanPromptInputs } from "@/lib/marketing-plan/plan-prompt";
import { buildPastPerformanceBlock } from "@/lib/performance-review/past-performance";
import { readStoredReview } from "@/lib/performance-review/stored-review";
import type { SessionContext } from "@/lib/session";
import { getFactValuesForSession } from "./business-profile";

// What a marketing plan is made from (step 37), gathered for one company:
// its confirmed facts (never a proposal), its approved marketing articles
// (searchKnowledge's audience: never a draft, an archived article or one
// for support only), its newest performance review (step 42: only the
// findings whose numbers were checked), and its ticket counts per
// category, only while an owner has that setting on. Nothing else of
// support, ever (IMPLEMENTATION_PLAN decision 3).

export type PlanInputs = {
  prompt: PlanPromptInputs;
  // The articles whose pieces the prompt holds, best first, each once.
  knowledgeUsed: string[];
  usedSupportTrends: boolean;
  // The performance review the prompt holds as past performance (null: none).
  performanceReviewId: string | null;
};

// The topics whose words find the articles a plan reads: what the business
// sells and what it wants marketing to do. Each gets its share of the
// search's words (combineSearchTexts): a long products list alone would
// fill them.
const KNOWLEDGE_SEARCH_TOPICS = new Set<BusinessFactTopic>(["products", "services", "goals"]);

// The session company's confirmed facts, in the profile's order. A
// proposal never counts: it is the AI's reading, not yet the owner's word.
export async function getConfirmedFactsForSession(session: SessionContext): Promise<ConfirmedFact[]> {
  const values = await getFactValuesForSession(session);
  return businessFactTopics.flatMap((topic) => {
    const value = values[topic]?.confirmedValue;
    return value ? [{ topic, value }] : [];
  });
}

// Gathers the rest of one company's plan request: the approved marketing
// articles that match what it sells and wants, and its support trends if
// an owner allowed them.
export async function gatherPlanInputs(companyId: string, facts: ConfirmedFact[], goalNote: string | null): Promise<PlanInputs> {
  const searchTexts = facts.filter((fact) => KNOWLEDGE_SEARCH_TOPICS.has(fact.topic)).map((fact) => fact.value);
  const [hits, usesSupportTrends, review] = await Promise.all([
    searchKnowledge(companyId, { query: combineSearchTexts(searchTexts), audience: "marketing", limit: PLAN_KNOWLEDGE_HITS }),
    getSupportTrendsSetting(companyId),
    getNewestPerformanceReview(companyId),
  ]);
  // At most 6,000 characters of whole pieces, best first.
  const slice = buildKnowledgeSlice(hits);
  const supportTrends = usesSupportTrends
    ? await countRecentTicketsPerCategory(companyId, SUPPORT_TREND_DAYS, SUPPORT_TREND_CATEGORIES_MAX)
    : null;
  // A review this code can't read (saved by another version) is left out.
  const stored = review ? readStoredReview(review.inputSummary, review.review) : null;
  const pastPerformance = review && stored ? buildPastPerformanceBlock(stored.review, stored.input, review.createdAt) : null;
  return {
    prompt: { facts, knowledgeSlice: slice.text, goalNote, supportTrends, pastPerformance },
    knowledgeUsed: [...new Set(slice.hits.map((hit) => hit.articleId))],
    usedSupportTrends: usesSupportTrends,
    performanceReviewId: review && stored ? review.id : null,
  };
}
