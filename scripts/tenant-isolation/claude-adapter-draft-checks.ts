// Claude adapter checks for the content studio's drafts (step 38): their
// own settings (effort medium, 12,000 tokens, 2 minutes a try, 1 retry),
// lighter than a marketing plan's and heavier than an interview turn's, a
// 500 tried twice, and a draft that never comes cut off at its longest run,
// inside the 300 seconds of the studio's pages. Its place in the no-key
// check is in claude-adapter-checks.ts. A FAKE client and fetch only:
// nothing here calls Anthropic.

import assert from "node:assert/strict";
import { askClaudeForContentDraft } from "@/adapters/claude";
import { CONTENT_DRAFT_SETTINGS, MARKETING_PLAN_SETTINGS, ONBOARDING_TURN_SETTINGS } from "@/adapters/claude-settings";
import {
  alwaysFailingClient,
  failIfStillWaitingAfter,
  longestRunMs,
  neverAnsweringClient,
  rateLimitedClient,
  recordingClient,
  REQUEST,
  ROUTE_MAX_DURATION_MS,
  withShortenedTimeouts,
} from "./claude-fakes";
import { check } from "./helpers";

export async function runClaudeAdapterDraftChecks() {
  await check("Claude adapter: a content draft sends its own settings: effort medium, 12,000 tokens, 2 minutes a try and one retry, between an interview turn and a plan", async () => {
    const recorder = recordingClient();
    assert.equal((await askClaudeForContentDraft(REQUEST, recorder.client)).kind, "ok");
    const [sent] = recorder.sent;
    assert.deepEqual(sent.body.output_config, { effort: "medium", format: { type: "json_schema", schema: REQUEST.jsonSchema } });
    assert.deepEqual([sent.body.max_tokens, sent.options.timeout, sent.options.maxRetries], [12_000, 120_000, 1]);
    assert.deepEqual([sent.body.system, sent.body.messages], ["fixed rules", [{ role: "user", content: "the slice" }]]);
    assert.ok(ONBOARDING_TURN_SETTINGS.maxTokens < CONTENT_DRAFT_SETTINGS.maxTokens && CONTENT_DRAFT_SETTINGS.maxTokens < MARKETING_PLAN_SETTINGS.maxTokens);
  });

  await check("Claude adapter: a content draft fits the studio pages' 300 seconds: a 500 is tried twice, and a 429's hour-long wait or a draft that never comes is cut off at its longest run", async () => {
    assert.ok(longestRunMs(CONTENT_DRAFT_SETTINGS) < ROUTE_MAX_DURATION_MS, `a draft can take ${longestRunMs(CONTENT_DRAFT_SETTINGS)} ms`);
    const failing = alwaysFailingClient();
    assert.deepEqual(await askClaudeForContentDraft(REQUEST, failing.client), { kind: "error", errorName: "InternalServerError" });
    assert.equal(failing.attempts.count, 2);
    const limited = rateLimitedClient();
    const rateLimited = await withShortenedTimeouts(() => failIfStillWaitingAfter(5_000, askClaudeForContentDraft(REQUEST, limited.client)));
    assert.deepEqual([rateLimited.result, limited.attempts.count, rateLimited.askedMs], [{ kind: "error", errorName: "APIUserAbortError" }, 1, [longestRunMs(CONTENT_DRAFT_SETTINGS)]]);
    const silent = neverAnsweringClient();
    const cutOff = await withShortenedTimeouts(() => failIfStillWaitingAfter(5_000, askClaudeForContentDraft(REQUEST, silent.client)));
    assert.deepEqual([cutOff.result, silent.attempts.count, cutOff.askedMs], [{ kind: "error", errorName: "APIUserAbortError" }, 1, [longestRunMs(CONTENT_DRAFT_SETTINGS)]]);
  });
}
