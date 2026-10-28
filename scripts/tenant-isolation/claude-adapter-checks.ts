// Step 28, one Claude adapter with separate uses: the call decision (effort
// high, 8,000 tokens, 60 s per attempt, 2 retries), email triage (lighter:
// effort medium, fewer tokens, less time, 1 retry), from step 36 the
// Co-Founder's interview turn (effort low) and suggestions (medium), from
// step 37 its marketing plans (effort high, one long try: their own checks
// are in claude-adapter-plan-checks.ts) and from step 38 its content drafts
// (claude-adapter-draft-checks.ts). Each fits
// the 300 seconds its route or page may run, and is cut off there even when
// a 429 asks for a long wait; nothing is asked without a key; and the
// triage schema sent to the API matches our own check of the answer. A FAKE
// client and fetch only: nothing here calls Anthropic.

import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  askClaudeForCalendarPlan,
  askClaudeForCallDecision,
  askClaudeForContentDraft,
  askClaudeForEmailTriage,
  askClaudeForFactSuggestions,
  askClaudeForMarketingPlan,
  askClaudeForOnboardingTurn,
  askClaudeForPerformanceReview,
} from "@/adapters/claude";
import {
  CALL_DECISION_SETTINGS,
  EMAIL_TRIAGE_SETTINGS,
  FACT_SUGGESTION_SETTINGS,
  MARKETING_PLAN_SETTINGS,
  ONBOARDING_TURN_SETTINGS,
} from "@/adapters/claude-settings";
import { RECEIVING_TIMING } from "@/adapters/resend";
import { buildTriageJsonSchema, buildTriageSchema } from "@/lib/email-triage/result";
import {
  alwaysFailingClient,
  failIfStillWaitingAfter,
  longestRunMs,
  rateLimitedClient,
  recordingClient,
  REQUEST,
  ROUTE_MAX_DURATION_MS,
  withShortenedTimeouts,
} from "./claude-fakes";
import { check } from "./helpers";

export async function runClaudeAdapterChecks() {
  await check("Claude adapter: the call decision and email triage each send their own effort, token limit, time limit and retries", async () => {
    const call = recordingClient();
    assert.equal((await askClaudeForCallDecision(REQUEST, call.client)).kind, "ok");
    const triage = recordingClient();
    assert.equal((await askClaudeForEmailTriage(REQUEST, triage.client)).kind, "ok");
    const [callSent, triageSent] = [call.sent[0], triage.sent[0]];

    // The call decision is unchanged by step 28.
    assert.deepEqual(callSent.body.output_config, { effort: "high", format: { type: "json_schema", schema: REQUEST.jsonSchema } });
    assert.deepEqual([callSent.body.max_tokens, callSent.options.timeout, callSent.options.maxRetries], [8_000, 60_000, 2]);
    assert.deepEqual([callSent.body.system, callSent.body.messages], ["fixed rules", [{ role: "user", content: "the slice" }]]);

    assert.deepEqual(triageSent.body.output_config, { effort: "medium", format: { type: "json_schema", schema: REQUEST.jsonSchema } });
    assert.deepEqual(
      [triageSent.body.max_tokens, triageSent.options.timeout, triageSent.options.maxRetries],
      [EMAIL_TRIAGE_SETTINGS.maxTokens, EMAIL_TRIAGE_SETTINGS.timeoutMs, EMAIL_TRIAGE_SETTINGS.maxRetries],
    );
    assert.ok(EMAIL_TRIAGE_SETTINGS.maxTokens < CALL_DECISION_SETTINGS.maxTokens, "triage may think as long as a call decision");
    assert.ok(EMAIL_TRIAGE_SETTINGS.timeoutMs < CALL_DECISION_SETTINGS.timeoutMs, "triage waits as long as a call decision");
    assert.ok(EMAIL_TRIAGE_SETTINGS.maxRetries < CALL_DECISION_SETTINGS.maxRetries, "triage retries as often as a call decision");
  });

  await check("Claude adapter: the Co-Founder's interview and its suggestions from knowledge each send their own settings, lighter than a call decision's", async () => {
    const uses = [
      { ask: askClaudeForOnboardingTurn, settings: ONBOARDING_TURN_SETTINGS, effort: "low" },
      { ask: askClaudeForFactSuggestions, settings: FACT_SUGGESTION_SETTINGS, effort: "medium" },
    ];
    for (const { ask, settings, effort } of uses) {
      const recorder = recordingClient();
      assert.equal((await ask(REQUEST, recorder.client)).kind, "ok");
      const [sent] = recorder.sent;
      assert.deepEqual(sent.body.output_config, { effort, format: { type: "json_schema", schema: REQUEST.jsonSchema } });
      assert.deepEqual([sent.body.max_tokens, sent.options.timeout, sent.options.maxRetries], [settings.maxTokens, settings.timeoutMs, settings.maxRetries]);
      assert.deepEqual([sent.body.system, sent.body.messages], ["fixed rules", [{ role: "user", content: "the slice" }]]);
      assert.ok(settings.maxTokens < CALL_DECISION_SETTINGS.maxTokens && settings.maxRetries < CALL_DECISION_SETTINGS.maxRetries);
    }
  });

  await check("Claude adapter: a request that keeps failing is tried 3 times for a call and 2 times for an email, then reported by class", async () => {
    const call = alwaysFailingClient();
    assert.deepEqual(await askClaudeForCallDecision(REQUEST, call.client), { kind: "error", errorName: "InternalServerError" });
    assert.equal(call.attempts.count, 3);
    const triage = alwaysFailingClient();
    assert.deepEqual(await askClaudeForEmailTriage(REQUEST, triage.client), { kind: "error", errorName: "InternalServerError" });
    assert.equal(triage.attempts.count, 2);
  });

  await check("Claude adapter: without an API key nothing is asked, for calls, emails, the interview, suggestions, marketing plans, content drafts, calendar plans and performance reviews", async () => {
    const asks = [
      askClaudeForCallDecision,
      askClaudeForEmailTriage,
      askClaudeForOnboardingTurn,
      askClaudeForFactSuggestions,
      askClaudeForMarketingPlan,
      askClaudeForContentDraft,
      askClaudeForCalendarPlan,
      askClaudeForPerformanceReview,
    ];
    for (const ask of asks) {
      assert.deepEqual(await ask(REQUEST, null), { kind: "unavailable" });
    }
  });

  await check("Claude adapter: a slow call decision, fetching plus triaging an email, and each Co-Founder request fit the 300 seconds their routes and pages may run", async () => {
    assert.ok(longestRunMs(CALL_DECISION_SETTINGS) < ROUTE_MAX_DURATION_MS, `a call decision can take ${longestRunMs(CALL_DECISION_SETTINGS)} ms`);
    const resendRetryWaitMs = RECEIVING_TIMING.retryDelaysMs.reduce((sum, delay) => sum + delay, 0);
    const resendLongestMs = RECEIVING_TIMING.timeoutMs * (RECEIVING_TIMING.retryDelaysMs.length + 1) + resendRetryWaitMs;
    const emailLongestMs = resendLongestMs + longestRunMs(EMAIL_TRIAGE_SETTINGS);
    assert.ok(emailLongestMs < ROUTE_MAX_DURATION_MS, `an email can take ${emailLongestMs} ms`);
    // The Co-Founder's pages wait for one request inside a server action.
    for (const settings of [ONBOARDING_TURN_SETTINGS, FACT_SUGGESTION_SETTINGS, MARKETING_PLAN_SETTINGS]) {
      assert.ok(longestRunMs(settings) < ROUTE_MAX_DURATION_MS, `a Co-Founder request can take ${longestRunMs(settings)} ms`);
    }
  });

  await check("Claude adapter: a request is cut off at its longest run, even when a 429 asks to wait an hour between attempts", async () => {
    const uses = [
      { ask: askClaudeForCallDecision, settings: CALL_DECISION_SETTINGS },
      { ask: askClaudeForEmailTriage, settings: EMAIL_TRIAGE_SETTINGS },
      { ask: askClaudeForOnboardingTurn, settings: ONBOARDING_TURN_SETTINGS },
      { ask: askClaudeForFactSuggestions, settings: FACT_SUGGESTION_SETTINGS },
    ];
    for (const { ask, settings } of uses) {
      const limited = rateLimitedClient();
      const { result, askedMs } = await withShortenedTimeouts(() => failIfStillWaitingAfter(5_000, ask(REQUEST, limited.client)));
      assert.deepEqual(result, { kind: "error", errorName: "APIUserAbortError" });
      assert.equal(limited.attempts.count, 1, "the hour-long wait was cut short, not followed by another attempt");
      assert.deepEqual(askedMs, [longestRunMs(settings)]);
    }
  });

  await check("Claude adapter: a failed request is named by the SDK's own error class, also when the production build shortens class names", async () => {
    // What a minified server bundle holds: the SDK's classes under one-letter names.
    const failures: [Error, string][] = [
      [new (class m extends Anthropic.AuthenticationError {})(401, undefined, "bad key", new Headers()), "AuthenticationError"],
      [new (class n extends Anthropic.NotFoundError {})(404, undefined, "no such model", new Headers()), "NotFoundError"],
      [new (class r extends Anthropic.RateLimitError {})(429, undefined, "slow down", new Headers()), "RateLimitError"],
      [new (class s extends Anthropic.InternalServerError {})(529, undefined, "overloaded", new Headers()), "InternalServerError"],
      [new (class t extends Anthropic.APIConnectionTimeoutError {})(), "APIConnectionTimeoutError"],
      [new (class u extends Anthropic.APIUserAbortError {})(), "APIUserAbortError"],
      [new TypeError("not the SDK's"), "TypeError"],
    ];
    for (const [error, name] of failures) {
      const throwing = { messages: { create: async () => Promise.reject(error) } } as unknown as Anthropic;
      assert.deepEqual(await askClaudeForContentDraft(REQUEST, throwing), { kind: "error", errorName: name });
    }
  });

  await check("email triage: the schema sent to the API and our own check agree", async () => {
    const categories = ["Billing", "Shipping"];
    const jsonSchema = buildTriageJsonSchema(categories);
    const zodSchema = buildTriageSchema(categories);
    const zodFields = Object.keys(zodSchema.shape).sort();
    assert.deepEqual(Object.keys(jsonSchema.properties).sort(), zodFields);
    assert.deepEqual([...jsonSchema.required].sort(), zodFields);
    assert.deepEqual([...jsonSchema.properties.category.enum].sort(), [...zodSchema.shape.category.options].sort());
    assert.equal(jsonSchema.additionalProperties, false);
    const valid = { customer_issue: "Needs a refund.", ticket_subject: "Refund", category: "Billing" };
    assert.equal(zodSchema.safeParse(valid).success, true);
    assert.equal(zodSchema.safeParse({ ...valid, companyId: "other" }).success, false);
    assert.equal(zodSchema.safeParse({ ...valid, category: "Refunds" }).success, false);
  });
}
