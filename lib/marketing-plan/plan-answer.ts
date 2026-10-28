import type { ModelResult } from "@/lib/model-request";
import { applyFactBasisRule } from "./fact-basis";
import { marketingPlanSchema, type MarketingPlan } from "./plan-schema";

// Reading a marketing plan (step 37): Claude's answer, and a stored plan.
// Both go through the same schema (plan-schema.ts) and the fact rule
// (fact-basis.ts). Pure.

// Claude's answer as a plan that may be saved, or null when there is none
// to save: not asked (no API key), refused, cut off, failed, not JSON,
// another shape, or without what a plan can't do without. sentTopics: the
// topics of the confirmed facts the request held.
export function readMarketingPlanAnswer(result: ModelResult, sentTopics: ReadonlySet<string>): MarketingPlan | null {
  if (result.kind !== "ok") {
    return null;
  }
  return readPlan(parseJsonOrNull(result.outputText), sentTopics);
}

// A stored plan for the page, or null when it doesn't fit the schema any
// more (saved by older code). The fact rule runs again against the facts
// the plan was made from, so the page never shows "Fact" for a topic that
// wasn't among them, whatever the row holds.
export function readStoredMarketingPlan(stored: unknown, factTopicsUsed: ReadonlySet<string>): MarketingPlan | null {
  return readPlan(stored, factTopicsUsed);
}

function readPlan(value: unknown, sentTopics: ReadonlySet<string>): MarketingPlan | null {
  const parsed = marketingPlanSchema.safeParse(value);
  return parsed.success ? applyFactBasisRule(parsed.data, sentTopics) : null;
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
