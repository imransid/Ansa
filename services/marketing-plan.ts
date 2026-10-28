import "server-only";
import { z } from "zod";
import { askClaudeForMarketingPlan } from "@/adapters/claude";
import { saveMarketingPlan } from "@/db/marketing-plans";
import { canManageMarketingStrategy } from "@/lib/cofounder/permissions";
import type { FormErrors } from "@/lib/form-result";
import { readMarketingPlanAnswer } from "@/lib/marketing-plan/plan-answer";
import { buildMarketingPlanJsonSchema } from "@/lib/marketing-plan/plan-json-schema";
import { buildMarketingPlanPrompt, MARKETING_PLAN_SYSTEM_PROMPT } from "@/lib/marketing-plan/plan-prompt";
import { findMissingPlanFacts } from "@/lib/marketing-plan/plan-readiness";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker, ModelResult } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import { marketingPlanRequestSchema } from "@/lib/validation/marketing-plan";
import { gatherPlanInputs, getConfirmedFactsForSession } from "./marketing-plan-inputs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The Co-Founder's marketing plan (step 37): an owner asks for a new
// version, and Claude writes it from what services/marketing-plan-inputs.ts
// gathers. A plan Claude couldn't write, or wrote in a shape we can't use,
// saves nothing. Reading plans: services/marketing-strategy.ts.
//
// LOGGING RULE for this file: never log the facts, the articles, the note,
// the prompt, Claude's answer or any error message. Fixed strings and class
// names only.

export type MarketingPlanResult = { ok: true; version: number } | { ok: false; errors: FormErrors };

// Makes a new version of the session company's marketing plan with Claude,
// and saves it. Owners only. askModel is only replaced by the checks.
export async function makeMarketingPlanForSession(
  session: SessionContext,
  input: unknown,
  askModel: ModelAsker = askClaudeForMarketingPlan,
): Promise<MarketingPlanResult> {
  const parsed = marketingPlanRequestSchema.safeParse(input);
  if (!parsed.success) {
    return goalNoteErrors(parsed.error);
  }
  if (!canManageMarketingStrategy(session.role)) {
    return notAnOwner();
  }
  const facts = await getConfirmedFactsForSession(session);
  const sentTopics = new Set(facts.map((fact) => fact.topic));
  // Without these Claude could only guess, so it isn't asked.
  const missing = findMissingPlanFacts(sentTopics);
  if (missing.length > 0) {
    const labels = missing.map((fact) => fact.label).join(", ");
    return { ok: false, errors: { message: `A plan needs these facts confirmed first: ${labels}. Confirm or fill them in on the Profile page.` } };
  }
  // Per company: every plan is a long, paid Claude call.
  if (await isOverRateLimit("marketing-plans", session.companyId, RATE_LIMITS.marketingPlansPerCompany)) {
    return { ok: false, errors: { message: "Your company asked for a lot of plans this hour. Wait a while and try again." } };
  }

  const inputs = await gatherPlanInputs(session.companyId, facts, parsed.data.goalNote);
  const result = await askModel({
    systemPrompt: MARKETING_PLAN_SYSTEM_PROMPT,
    prompt: buildMarketingPlanPrompt(inputs.prompt),
    jsonSchema: buildMarketingPlanJsonSchema(),
  });
  const failure = describeModelFailure(result);
  if (failure) {
    // One fixed line with the class: a revoked key (AuthenticationError) and
    // a wrong model name (NotFoundError) need different fixes.
    console.error(`Claude call failed: ${failure}`);
  }
  const plan = readMarketingPlanAnswer(result, sentTopics);
  if (!plan) {
    return { ok: false, errors: { message: describeNoPlan(result) } };
  }

  const saved = await saveMarketingPlan(session.companyId, session.userId, {
    goalNote: parsed.data.goalNote,
    plan,
    factsUsed: facts,
    knowledgeUsed: inputs.knowledgeUsed,
    usedSupportTrends: inputs.usedSupportTrends,
    performanceReviewId: inputs.performanceReviewId,
  });
  return saved.outcome === "saved" ? { ok: true, version: saved.version } : notAnOwner();
}

// Why no plan came back, in plain words: never a server setting or an
// error's text (the log line has the class).
function describeNoPlan(result: ModelResult): string {
  if (result.kind === "unavailable") {
    return "The AI isn't available right now, so no plan was made. Try again later.";
  }
  if (result.kind === "ok") {
    return "The AI's plan came back in a form that can't be used, so nothing was saved. Try again.";
  }
  return "The AI couldn't write a plan just now, so nothing was saved. Try again in a few minutes.";
}

// The note's own problems go under the box.
function goalNoteErrors(error: z.ZodError): MarketingPlanResult {
  return { ok: false, errors: { fieldErrors: z.flattenError(error).fieldErrors } };
}

function notAnOwner(): { ok: false; errors: FormErrors } {
  return { ok: false, errors: { message: "Only owners can make a marketing plan." } };
}
