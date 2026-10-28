// Marketing plan answer checks (step 37): a failed, refused, cut-off or
// unusable answer saves nothing and says so plainly; an answer of another
// shape is unusable; and the fact rule (a "fact" naming no confirmed fact
// that was sent is an assumption), stored and shown, whatever a row says.
// The schema, the cutting rules and trusted fields:
// marketing-plan-schema-checks.ts. A FAKE model only: nothing calls
// Anthropic.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { marketingPlans } from "@/db/schema";
import { readMarketingPlanAnswer } from "@/lib/marketing-plan/plan-answer";
import type { ModelResult } from "@/lib/model-request";
import { getStrategyPageForSession } from "@/services/marketing-strategy";
import { messageOf, modelAnswer, proposeInInterview } from "./cofounder-helpers";
import { captureConsole, check, sessionFor, signUpTestOwner } from "./helpers";
import { makePlan, makeReadyForPlan, makeWorkingPlan, planAnswer, planAnswerJson, planRows } from "./marketing-plan-helpers";

const SENT = new Set(["description"]);

function readsAsPlan(json: unknown): boolean {
  return readMarketingPlanAnswer(modelAnswer(json), SENT) !== null;
}

export async function runMarketingPlanAnswerChecks() {
  await check("marketing plan: a failed, refused, cut-off or unusable answer saves nothing and says so plainly; a failure logs one fixed line", async () => {
    const owner = sessionFor(await signUpTestOwner("plan-failures"));
    await makeReadyForPlan(owner);
    const json = planAnswerJson();
    const failures: { answer: ModelResult; message: RegExp; logs: string[] }[] = [
      { answer: { kind: "unavailable" }, message: /isn't available right now, so no plan was made/, logs: [] },
      { answer: { kind: "refused" }, message: /couldn't write a plan just now/, logs: ["Claude call failed: refused"] },
      { answer: { kind: "truncated" }, message: /couldn't write a plan just now/, logs: ["Claude call failed: truncated"] },
      { answer: { kind: "unexpected-stop" }, message: /couldn't write a plan just now/, logs: ["Claude call failed: unexpected_stop"] },
      { answer: { kind: "error", errorName: "RateLimitError" }, message: /couldn't write a plan just now/, logs: ["Claude call failed: RateLimitError"] },
      { answer: { kind: "ok", outputText: "Here is your plan!", usage: { inputTokens: 1, outputTokens: 1 } }, message: /can't be used/, logs: [] },
      { answer: planAnswer({ companyId: owner.companyId }), message: /can't be used/, logs: [] },
      { answer: planAnswer({ pillars: (json.pillars as unknown[]).slice(0, 2) }), message: /can't be used/, logs: [] },
    ];
    for (const { answer, message, logs } of failures) {
      const printed = await captureConsole(() => makePlan(owner, "", answer));
      const text = messageOf(printed.result.result);
      assert.match(text, message, answer.kind);
      assert.ok(!/ANTHROPIC|Error|key|JSON/.test(text), `the message names a setting or an error: ${text}`);
      assert.deepEqual(printed.logs, logs, answer.kind);
    }
    assert.deepEqual(await planRows(owner.companyId), []);
  });

  await check("marketing plan: an answer of another shape is unusable: a field missing, blank or unknown, too few entries, an unknown platform or basis, a cadence out of range", async () => {
    const json = planAnswerJson();
    const pillar = (json.pillars as Record<string, unknown>[])[0];
    const campaign = (json.campaigns as Record<string, unknown>[])[0];
    assert.ok(readsAsPlan(json), "the sample plan is not usable");
    const unusable: Record<string, unknown>[] = [
      {},
      { ...json, summary: "   " },
      { ...json, positioning: "\u200B" },
      { ...json, audiences: [] },
      { ...json, goals: [] },
      { ...json, pillars: [pillar, pillar] },
      { ...json, pillars: [{ ...pillar, example_topics: ["", " "] }, pillar, pillar] },
      { ...json, campaigns: [] },
      { ...json, campaigns: [{ ...campaign, platforms: ["instagram"] }] },
      { ...json, campaigns: [{ ...campaign, platforms: [] }] },
      { ...json, cadence: [{ platform: "facebook", posts_per_week: 0, formats: [] }] },
      { ...json, cadence: [{ platform: "facebook", posts_per_week: 15, formats: [] }] },
      { ...json, cadence: [{ platform: "facebook", posts_per_week: -1, formats: [] }] },
      { ...json, cadence: [{ platform: "tiktok", posts_per_week: 2, formats: [] }] },
      { ...json, statements: [] },
      { ...json, statements: [{ text: "We bake.", basis: "maybe", fact_topics: [] }] },
      { ...json, missing_information: "Your prices" },
    ];
    for (const answer of unusable) {
      assert.equal(readsAsPlan(answer), false, JSON.stringify(answer).slice(0, 120));
    }
  });

  await check("marketing plan: a 'fact' naming no confirmed fact that was sent is stored and shown as an assumption; one naming only sent facts stays a fact, whatever the row says", async () => {
    const owner = sessionFor(await signUpTestOwner("plan-basis"));
    await makeReadyForPlan(owner);
    // Only proposed: never sent, so never a fact.
    await proposeInInterview(owner, [{ topic: "prices", value: "Bread from 3 euros" }]);
    const statements = [
      { text: "One", basis: "fact", fact_topics: ["description"] },
      { text: "Two", basis: "fact", fact_topics: [] },
      { text: "Three", basis: "fact", fact_topics: ["prices"] },
      { text: "Four", basis: "fact", fact_topics: ["description", "competitors"] },
      { text: "Five", basis: "fact", fact_topics: ["products", "target_customers", "products"] },
      { text: "Six", basis: "suggestion", fact_topics: ["description", "prices"] },
      { text: "Seven", basis: "assumption", fact_topics: ["prices"] },
      { text: "Eight", basis: "fact", fact_topics: ["secret_plans"] },
    ];
    await makeWorkingPlan(owner, "", planAnswer({ statements }));
    const expected = [
      { text: "One", basis: "fact", fact_topics: ["description"] },
      { text: "Two", basis: "assumption", fact_topics: [] },
      { text: "Three", basis: "assumption", fact_topics: [] },
      { text: "Four", basis: "assumption", fact_topics: ["description"] },
      { text: "Five", basis: "fact", fact_topics: ["products", "target_customers"] },
      { text: "Six", basis: "suggestion", fact_topics: ["description"] },
      { text: "Seven", basis: "assumption", fact_topics: [] },
      { text: "Eight", basis: "assumption", fact_topics: [] },
    ];
    const [row] = await planRows(owner.companyId);
    assert.deepEqual((row.plan as { statements: unknown }).statements, expected, "stored");
    assert.deepEqual((await getStrategyPageForSession(owner)).current?.content?.statements, expected, "shown");
    // A row saying "fact" for a topic the plan wasn't made from is shown as an assumption.
    const tampered = { ...(row.plan as Record<string, unknown>), statements: [{ text: "Nine", basis: "fact", fact_topics: ["prices"] }] };
    await db.update(marketingPlans).set({ plan: tampered }).where(eq(marketingPlans.id, row.id));
    assert.deepEqual((await getStrategyPageForSession(owner)).current?.content?.statements, [{ text: "Nine", basis: "assumption", fact_topics: [] }]);
  });

}
