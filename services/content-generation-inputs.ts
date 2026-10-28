import "server-only";
import { searchKnowledge } from "@/db/knowledge-search";
import { getNewestMarketingPlan } from "@/db/marketing-plans";
import type { ContentFormat } from "@/lib/content-studio/formats";
import type { CampaignForPrompt, DraftPromptInputs, PillarForPrompt } from "@/lib/content-studio/draft-prompt";
import { DRAFT_KNOWLEDGE_CHARACTERS, DRAFT_KNOWLEDGE_HITS } from "@/lib/content-studio/limits";
import { readWordsToAvoid } from "@/lib/content-studio/words-to-avoid";
import { buildKnowledgeSlice } from "@/lib/knowledge/prompt-slice";
import { combineSearchTexts } from "@/lib/knowledge/search-query";
import { readStoredMarketingPlan } from "@/lib/marketing-plan/plan-answer";
import type { ConfirmedFact } from "@/lib/marketing-plan/plan-prompt";
import type { MarketingPlan } from "@/lib/marketing-plan/plan-schema";
import type { SocialPlatform } from "@/lib/social-platforms";

// What a content draft is written from (step 38), gathered for one
// company: its confirmed facts (never a proposal; the caller reads them),
// the words to avoid among them, the current marketing plan's positioning
// and audiences and the pillar and campaign picked from it, and approved
// marketing articles that match the topic (searchKnowledge's audience:
// never a draft, an archived article or one for support only). Nothing of
// support, tickets or customers, ever (IMPLEMENTATION_PLAN decision 3).

export type DraftRequest = { platform: SocialPlatform; format: ContentFormat; topic: string; pillar: string; campaign: string };

export type DraftInputs = {
  prompt: DraftPromptInputs;
  // The articles whose pieces the prompt holds, best first, each once.
  knowledgeUsed: string[];
  // The plan version the prompt read (null: none).
  planVersion: number | null;
};

export type CurrentPlan = { version: number; content: MarketingPlan };

// Gathers one company's draft request around its confirmed facts.
export async function gatherDraftInputs(companyId: string, facts: ConfirmedFact[], request: DraftRequest): Promise<DraftInputs> {
  const [plan, hits] = await Promise.all([
    readCurrentPlan(companyId),
    searchKnowledge(companyId, {
      query: combineSearchTexts([request.topic, request.pillar, request.campaign]),
      audience: "marketing",
      limit: DRAFT_KNOWLEDGE_HITS,
    }),
  ]);
  // Whole pieces, best first, within DRAFT_KNOWLEDGE_CHARACTERS.
  const slice = buildKnowledgeSlice(hits, DRAFT_KNOWLEDGE_CHARACTERS);
  return {
    prompt: {
      platform: request.platform,
      format: request.format,
      topic: request.topic,
      pillar: pillarFor(plan, request.pillar),
      campaign: campaignFor(plan, request.campaign),
      plan: plan ? planForPrompt(plan.content) : null,
      facts,
      wordsToAvoid: readWordsToAvoid(facts.find((fact) => fact.topic === "words_to_avoid")?.value ?? null),
      knowledgeSlice: slice.text,
    },
    knowledgeUsed: [...new Set(slice.hits.map((hit) => hit.articleId))],
    planVersion: plan?.version ?? null,
  };
}

// One company's newest marketing plan, read with the plan's own schema
// (null: no plan, or one saved in a shape this code can't read). Only its
// audiences, positioning, pillars and campaigns are used here, never its
// statements, so the fact rule needs no facts.
export async function readCurrentPlan(companyId: string): Promise<CurrentPlan | null> {
  const row = await getNewestMarketingPlan(companyId);
  const content = row ? readStoredMarketingPlan(row.plan, new Set()) : null;
  return row && content ? { version: row.version, content } : null;
}

// The plan's positioning and audiences, as the prompt holds them.
function planForPrompt(plan: MarketingPlan): DraftPromptInputs["plan"] {
  return {
    positioning: plan.positioning,
    audiences: plan.audiences.map((audience) => ({ name: audience.name, needs: audience.needs, whereToReach: audience.where_to_reach })),
  };
}

// The picked pillar with what the plan says about it; a name the current
// plan doesn't have (a newer plan renamed it) goes as the name alone.
function pillarFor(plan: CurrentPlan | null, name: string): PillarForPrompt | null {
  if (!name) {
    return null;
  }
  const pillar = plan?.content.pillars.find((candidate) => sameName(candidate.name, name));
  return pillar ? { name: pillar.name, description: pillar.description, exampleTopics: pillar.example_topics } : { name, description: null, exampleTopics: [] };
}

// The picked campaign with what the plan says about it, as for pillars.
function campaignFor(plan: CurrentPlan | null, name: string): CampaignForPrompt | null {
  if (!name) {
    return null;
  }
  const campaign = plan?.content.campaigns.find((candidate) => sameName(candidate.name, name));
  if (!campaign) {
    return { name, objective: null, timing: null, callToAction: null };
  }
  return { name: campaign.name, objective: campaign.objective, timing: campaign.timing, callToAction: campaign.call_to_action };
}

// A name picked from the plan matches its pillar or campaign whatever its case.
function sameName(planName: string, picked: string): boolean {
  return planName.trim().toLowerCase() === picked.trim().toLowerCase();
}
