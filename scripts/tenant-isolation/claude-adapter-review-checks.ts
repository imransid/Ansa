// Claude adapter checks for "Review performance" on the Analytics page
// (step 42): its own settings (effort medium, 8,000 tokens, 120 s a try, 1
// retry), a 500 tried twice, and a review that never comes cut off at its
// longest run, inside the page's 300 seconds. Its place in the no-key
// check is in claude-adapter-checks.ts. A FAKE client and fetch only:
// nothing here calls Anthropic.

import assert from "node:assert/strict";
import { askClaudeForPerformanceReview } from "@/adapters/claude";
import { PERFORMANCE_REVIEW_SETTINGS } from "@/adapters/claude-settings";
import { alwaysFailingClient, failIfStillWaitingAfter, longestRunMs, neverAnsweringClient, recordingClient, REQUEST, ROUTE_MAX_DURATION_MS, withShortenedTimeouts } from "./claude-fakes";
import { check } from "./helpers";

export async function runClaudeAdapterReviewChecks() {
  await check("Claude adapter: a performance review sends its own settings: effort medium, 8,000 tokens, 120 seconds a try and one retry", async () => {
    const recorder = recordingClient();
    assert.equal((await askClaudeForPerformanceReview(REQUEST, recorder.client)).kind, "ok");
    const [sent] = recorder.sent;
    assert.deepEqual(sent.body.output_config, { effort: "medium", format: { type: "json_schema", schema: REQUEST.jsonSchema } });
    assert.deepEqual([sent.body.max_tokens, sent.options.timeout, sent.options.maxRetries], [8_000, 120_000, 1]);
    assert.deepEqual([sent.body.system, sent.body.messages], ["fixed rules", [{ role: "user", content: "the slice" }]]);
  });

  await check("Claude adapter: a performance review fits the Analytics page's 300 seconds: a 500 is tried twice, and a review that never comes is cut off at its longest run", async () => {
    assert.ok(longestRunMs(PERFORMANCE_REVIEW_SETTINGS) < ROUTE_MAX_DURATION_MS, `a review can take ${longestRunMs(PERFORMANCE_REVIEW_SETTINGS)} ms`);
    const failing = alwaysFailingClient();
    assert.deepEqual(await askClaudeForPerformanceReview(REQUEST, failing.client), { kind: "error", errorName: "InternalServerError" });
    assert.equal(failing.attempts.count, 2);
    const silent = neverAnsweringClient();
    const cutOff = await withShortenedTimeouts(() => failIfStillWaitingAfter(5_000, askClaudeForPerformanceReview(REQUEST, silent.client)));
    assert.deepEqual([cutOff.result, silent.attempts.count, cutOff.askedMs], [{ kind: "error", errorName: "APIUserAbortError" }, 1, [longestRunMs(PERFORMANCE_REVIEW_SETTINGS)]]);
  });
}
