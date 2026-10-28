// Shared pieces for the marketing plan checks (step 37): a plan as Claude
// writes it, a profile ready for a plan, making one the way the Strategy
// page does (with a stand-in for Claude), and what the database holds.

import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { marketingPlans } from "@/db/schema";
import type { ModelResult } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import { makeMarketingPlanForSession } from "@/services/marketing-plan";
import { modelAnswer, scriptedModel, typeFact } from "./cofounder-helpers";

// The facts a plan can't do without, as makeReadyForPlan types them.
export const READY_FACTS = {
  description: "Bluebird Bakery bakes sourdough bread in Lisbon.",
  products: "Sourdough bread and pastries",
  target_customers: "Office workers nearby",
} as const;

// A plan as Claude writes it: every field, each list with what it needs.
// `overrides` replaces whole top-level fields.
export function planAnswerJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: "Bring more weekday customers to the bakery with useful, friendly posts.",
    audiences: [{ name: "Office workers", needs: "A quick, good lunch.", where_to_reach: "LinkedIn and local Facebook groups." }],
    positioning: "The neighbourhood bakery that bakes everything fresh every morning.",
    goals: [{ goal: "More weekday lunch visits", how_to_measure: "Count the lunch orders each week." }],
    pillars: [
      { name: "Behind the oven", description: "How the bread is made.", example_topics: ["The morning bake", "Our sourdough starter"] },
      { name: "Lunch ideas", description: "What to eat this week.", example_topics: ["Soup of the day"] },
      { name: "Neighbours", description: "The street around the shop.", example_topics: ["Market day"] },
    ],
    campaigns: [
      {
        name: "Lunch week",
        objective: "Show the weekday lunch menu.",
        pillar: "Lunch ideas",
        platforms: ["facebook", "linkedin"],
        timing: "Next month",
        call_to_action: "Order at the counter",
      },
    ],
    cadence: [{ platform: "facebook", posts_per_week: 3, formats: ["photo"] }],
    statements: [
      { text: "The bakery bakes sourdough bread in Lisbon.", basis: "fact", fact_topics: ["description"] },
      { text: "Office workers want a quick lunch.", basis: "assumption", fact_topics: [] },
      { text: "Post the lunch menu every Monday.", basis: "suggestion", fact_topics: [] },
    ],
    missing_information: ["Your prices"],
    cautions: ["Check any health claim before posting it."],
    ...overrides,
  };
}

// A Claude answer holding that plan.
export function planAnswer(overrides: Record<string, unknown> = {}): ModelResult {
  return modelAnswer(planAnswerJson(overrides));
}

// Confirms the facts a plan can't do without, as an owner typing them.
export async function makeReadyForPlan(owner: SessionContext): Promise<void> {
  for (const [topic, value] of Object.entries(READY_FACTS)) {
    await typeFact(owner, topic as keyof typeof READY_FACTS, value);
  }
}

// Makes a plan as the Strategy page's form does, with a stand-in for
// Claude that gives `answer`, and returns what came back and what was asked.
export async function makePlan(owner: SessionContext, goalNote: string | null = "", answer: ModelResult = planAnswer()) {
  const model = scriptedModel([answer]);
  const result = await makeMarketingPlanForSession(owner, { goalNote }, model.ask);
  return { result, model };
}

// Makes a plan that must work, and returns its version.
export async function makeWorkingPlan(owner: SessionContext, goalNote = "", answer: ModelResult = planAnswer()): Promise<number> {
  const { result } = await makePlan(owner, goalNote, answer);
  assert.ok(result.ok, `no plan: ${JSON.stringify(result)}`);
  return result.version;
}

// One company's plan rows as stored, oldest version first.
export async function planRows(companyId: string) {
  return db.select().from(marketingPlans).where(eq(marketingPlans.companyId, companyId)).orderBy(asc(marketingPlans.version));
}

// How often `part` appears in `text`.
export function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}
