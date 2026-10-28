// Claude adapter checks for the Co-Founder's marketing plans (step 37):
// their own settings (effort high, room for the whole plan, one long try of
// 270 s, more room than any other use), no retry after a 500 or a 429, and
// a plan that never comes is cut off at its longest run. The plan's place
// in the 300-second and no-key checks is in claude-adapter-checks.ts. A FAKE
// client and fetch only: nothing here calls Anthropic.

import assert from "node:assert/strict";
import { askClaudeForMarketingPlan } from "@/adapters/claude";
import {
  CALL_DECISION_SETTINGS,
  EMAIL_TRIAGE_SETTINGS,
  FACT_SUGGESTION_SETTINGS,
  MARKETING_PLAN_SETTINGS,
  ONBOARDING_TURN_SETTINGS,
} from "@/adapters/claude-settings";
import {
  alwaysFailingClient,
  failIfStillWaitingAfter,
  longestRunMs,
  neverAnsweringClient,
  rateLimitedClient,
  recordingClient,
  REQUEST,
  withShortenedTimeouts,
} from "./claude-fakes";
import { check } from "./helpers";

export async function runClaudeAdapterPlanChecks() {
  await check("Claude adapter: a marketing plan sends its own settings: effort high, room for the whole plan, one long try", async () => {
    const recorder = recordingClient();
    assert.equal((await askClaudeForMarketingPlan(REQUEST, recorder.client)).kind, "ok");
    const [sent] = recorder.sent;
    assert.deepEqual(sent.body.output_config, { effort: "high", format: { type: "json_schema", schema: REQUEST.jsonSchema } });
    assert.deepEqual([sent.body.max_tokens, sent.options.timeout, sent.options.maxRetries], [16_000, 270_000, 0]);
    assert.deepEqual([sent.body.system, sent.body.messages], ["fixed rules", [{ role: "user", content: "the slice" }]]);
    // More room than any other use: a plan is the longest answer the app asks for.
    for (const settings of [CALL_DECISION_SETTINGS, EMAIL_TRIAGE_SETTINGS, ONBOARDING_TURN_SETTINGS, FACT_SUGGESTION_SETTINGS]) {
      assert.ok(MARKETING_PLAN_SETTINGS.maxTokens >= settings.maxTokens);
    }
  });

  await check("Claude adapter: a marketing plan is tried once: a 500 or a 429 is not retried, and a plan that never comes is cut off at its longest run", async () => {
    const failing = alwaysFailingClient();
    assert.deepEqual(await askClaudeForMarketingPlan(REQUEST, failing.client), { kind: "error", errorName: "InternalServerError" });
    assert.equal(failing.attempts.count, 1);
    const limited = rateLimitedClient();
    const rateLimited = await withShortenedTimeouts(() => failIfStillWaitingAfter(5_000, askClaudeForMarketingPlan(REQUEST, limited.client)));
    assert.deepEqual([rateLimited.result, limited.attempts.count, rateLimited.askedMs], [{ kind: "error", errorName: "RateLimitError" }, 1, [longestRunMs(MARKETING_PLAN_SETTINGS)]]);
    const silent = neverAnsweringClient();
    const cutOff = await withShortenedTimeouts(() => failIfStillWaitingAfter(5_000, askClaudeForMarketingPlan(REQUEST, silent.client)));
    assert.deepEqual([cutOff.result, silent.attempts.count, cutOff.askedMs], [{ kind: "error", errorName: "APIUserAbortError" }, 1, [270_000]]);
  });
}
