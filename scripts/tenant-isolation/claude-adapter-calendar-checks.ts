// Claude adapter checks for "Plan the next 2 weeks" on the calendar (step
// 41): its own settings (effort medium, 6,000 tokens, 90 s a try, 1 retry),
// less room than a content draft's, a 500 tried twice, and a plan that
// never comes cut off at its longest run, inside the calendar page's 300
// seconds. Its place in the no-key check is in claude-adapter-checks.ts. A
// FAKE client and fetch only: nothing here calls Anthropic.

import assert from "node:assert/strict";
import { askClaudeForCalendarPlan } from "@/adapters/claude";
import { CALENDAR_PLAN_SETTINGS, CONTENT_DRAFT_SETTINGS } from "@/adapters/claude-settings";
import {
  alwaysFailingClient,
  failIfStillWaitingAfter,
  longestRunMs,
  neverAnsweringClient,
  recordingClient,
  REQUEST,
  ROUTE_MAX_DURATION_MS,
  withShortenedTimeouts,
} from "./claude-fakes";
import { check } from "./helpers";

export async function runClaudeAdapterCalendarChecks() {
  await check("Claude adapter: a calendar plan sends its own settings: effort medium, 6,000 tokens, 90 seconds a try and one retry, less room than a content draft", async () => {
    const recorder = recordingClient();
    assert.equal((await askClaudeForCalendarPlan(REQUEST, recorder.client)).kind, "ok");
    const [sent] = recorder.sent;
    assert.deepEqual(sent.body.output_config, { effort: "medium", format: { type: "json_schema", schema: REQUEST.jsonSchema } });
    assert.deepEqual([sent.body.max_tokens, sent.options.timeout, sent.options.maxRetries], [6_000, 90_000, 1]);
    assert.deepEqual([sent.body.system, sent.body.messages], ["fixed rules", [{ role: "user", content: "the slice" }]]);
    assert.ok(CALENDAR_PLAN_SETTINGS.maxTokens < CONTENT_DRAFT_SETTINGS.maxTokens);
  });

  await check("Claude adapter: a calendar plan fits the calendar page's 300 seconds: a 500 is tried twice, and a plan that never comes is cut off at its longest run", async () => {
    assert.ok(longestRunMs(CALENDAR_PLAN_SETTINGS) < ROUTE_MAX_DURATION_MS, `a calendar plan can take ${longestRunMs(CALENDAR_PLAN_SETTINGS)} ms`);
    const failing = alwaysFailingClient();
    assert.deepEqual(await askClaudeForCalendarPlan(REQUEST, failing.client), { kind: "error", errorName: "InternalServerError" });
    assert.equal(failing.attempts.count, 2);
    const silent = neverAnsweringClient();
    const cutOff = await withShortenedTimeouts(() => failIfStillWaitingAfter(5_000, askClaudeForCalendarPlan(REQUEST, silent.client)));
    assert.deepEqual([cutOff.result, silent.attempts.count, cutOff.askedMs], [{ kind: "error", errorName: "APIUserAbortError" }, 1, [longestRunMs(CALENDAR_PLAN_SETTINGS)]]);
  });
}
