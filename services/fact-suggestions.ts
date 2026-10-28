import "server-only";
import { z } from "zod";
import { askClaudeForFactSuggestions } from "@/adapters/claude";
import { saveKnowledgeFactProposals } from "@/db/business-fact-proposals";
import { getApprovedKnowledgeArticleTitles, getKnowledgeArticleForCompany } from "@/db/knowledge-articles";
import { BUSINESS_FACT_TOPICS, type BusinessFactTopic } from "@/lib/business-facts";
import {
  buildArticleSliceForSuggestions,
  buildFactSuggestionJsonSchema,
  buildFactSuggestionPrompt,
  FACT_SUGGESTION_SYSTEM_PROMPT,
  readFactSuggestions,
} from "@/lib/cofounder/fact-suggestions";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import type { FormErrors } from "@/lib/form-result";
import { MAX_KNOWLEDGE_ARTICLES_PER_COMPANY } from "@/lib/knowledge/limits";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import { factSuggestionSchema } from "@/lib/validation/cofounder";
import { getFactValuesForSession } from "./business-profile";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// "Suggest facts from knowledge" (step 36): an owner picks one of the
// company's approved knowledge articles meant for support or marketing, and
// Claude proposes the facts it states. Proposals only, saved beside the
// confirmed values for an owner to confirm or dismiss on the Profile page.
//
// LOGGING RULE: never log the article, the prompt, Claude's answer or any
// error message. Fixed strings and class names only.

export type FactSuggestionResult =
  | {
      ok: true;
      // The topics that got a new proposal (none: the article said nothing new).
      proposedTopics: { topic: BusinessFactTopic; label: string }[];
      // false: the article is longer than the AI reads, so only its first part was read.
      readWholeArticle: boolean;
    }
  | { ok: false; errors: FormErrors };

// The session company's approved articles an owner may pick, by title: all
// of them. WHY the company's article cap as the limit: a company never has
// more articles than that, so the menu never leaves one out.
export async function listArticlesForSuggestionsForSession(session: SessionContext): Promise<{ id: string; title: string }[]> {
  return getApprovedKnowledgeArticleTitles(session.companyId, MAX_KNOWLEDGE_ARTICLES_PER_COMPANY);
}

// Lets Claude read one approved article of the session's company and saves
// the facts it proposes. Owners only. askModel is only replaced by the checks.
export async function suggestFactsFromKnowledgeForSession(
  session: SessionContext,
  input: unknown,
  askModel: ModelAsker = askClaudeForFactSuggestions,
): Promise<FactSuggestionResult> {
  const parsed = factSuggestionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (!canManageBusinessProfile(session.role)) {
    return notAnOwner();
  }
  if (await isOverRateLimit("fact-suggestions", session.companyId, RATE_LIMITS.factSuggestionsPerCompany)) {
    return { ok: false, errors: { message: "Your company asked for a lot of suggestions this hour. Wait a while and try again." } };
  }
  const article = await getKnowledgeArticleForCompany(session.companyId, parsed.data.articleId);
  // Drafts and archived articles are never given to any AI (step 34).
  if (!article || article.status !== "approved") {
    return { ok: false, errors: { message: "That article is not an approved article of your company. Reload the page and pick another." } };
  }
  // Its page says nothing uses it, so no AI reads it.
  if (!article.useForSupport && !article.useForMarketing) {
    return {
      ok: false,
      errors: { message: "That article is ticked for neither support nor marketing, so no AI may read it. Tick one on its Knowledge page, or pick another." },
    };
  }

  const facts = await getFactValuesForSession(session);
  const { slice, readWholeArticle } = buildArticleSliceForSuggestions(article);
  const result = await askModel({
    systemPrompt: FACT_SUGGESTION_SYSTEM_PROMPT,
    prompt: buildFactSuggestionPrompt(facts, slice),
    jsonSchema: buildFactSuggestionJsonSchema(),
  });
  const failure = describeModelFailure(result);
  if (failure) {
    console.error(`Claude call failed: ${failure}`);
  }
  const proposals = readFactSuggestions(result);
  if (!proposals) {
    return { ok: false, errors: { message: "The AI couldn't read the article just now, so nothing was proposed. Try again later." } };
  }

  const saved = await saveKnowledgeFactProposals(session.companyId, session.userId, proposals);
  if (saved.outcome === "not-allowed") {
    return notAnOwner();
  }
  return {
    ok: true,
    proposedTopics: saved.proposedTopics.map((topic) => ({ topic, label: BUSINESS_FACT_TOPICS[topic].label })),
    readWholeArticle,
  };
}

function notAnOwner(): { ok: false; errors: FormErrors } {
  return { ok: false, errors: { message: "Only owners can ask for suggestions." } };
}
