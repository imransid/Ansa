import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import type { ModelRequest, ModelResult } from "@/lib/model-request";
import { nameOfError } from "./claude-errors";
import {
  CALENDAR_PLAN_SETTINGS,
  CALL_DECISION_SETTINGS,
  CONTENT_DRAFT_SETTINGS,
  EMAIL_TRIAGE_SETTINGS,
  FACT_SUGGESTION_SETTINGS,
  longestRequestMs,
  MARKETING_PLAN_SETTINGS,
  ONBOARDING_TURN_SETTINGS,
  PERFORMANCE_REVIEW_SETTINGS,
  type RequestSettings,
} from "./claude-settings";

// The only file that talks to Anthropic. Each use has its own function here
// and its own settings in adapters/claude-settings.ts, so tuning one (the
// call brain, email triage, the Co-Founder's interview, its suggestions from
// knowledge, its marketing plans, its content drafts, its calendar or its
// performance reviews) never changes another.
//
// LOGGING RULE: the prompt holds part of a call transcript, an email, an
// owner's interview answers and business facts, or what a marketing plan, a
// content draft, a calendar plan or a performance review is made from, and
// the response is model text about it. Neither is ever logged, and neither are SDK error messages
// (they can quote the response). Only error class names leave here
// (nameOfError), and the SDK itself is told never to log (createClaudeClient).
//
// No refusal fallback on purpose: if the chosen model declines, the call is
// escalated (or the email ticketed without the AI, the interview goes on
// with its fixed question, or no plan, draft, idea or review is saved). One
// predictable path, no model we didn't pick.

// Asks Claude to decide one finished call (solved, or needs a human).
// `client` is only replaced by the checks (a fake fetch, no network).
export async function askClaudeForCallDecision(request: ModelRequest, client = clientFromEnv()): Promise<ModelResult> {
  return askClaude(client, request, CALL_DECISION_SETTINGS);
}

// Asks Claude to triage one received email (summary, subject, category).
// `client` is only replaced by the checks (a fake fetch, no network).
export async function askClaudeForEmailTriage(request: ModelRequest, client = clientFromEnv()): Promise<ModelResult> {
  return askClaude(client, request, EMAIL_TRIAGE_SETTINGS);
}

// Asks Claude for one turn of the Co-Founder's interview (proposed facts and
// the next question). `client` is only replaced by the checks.
export async function askClaudeForOnboardingTurn(request: ModelRequest, client = clientFromEnv()): Promise<ModelResult> {
  return askClaude(client, request, ONBOARDING_TURN_SETTINGS);
}

// Asks Claude to propose business facts from one knowledge article.
// `client` is only replaced by the checks.
export async function askClaudeForFactSuggestions(request: ModelRequest, client = clientFromEnv()): Promise<ModelResult> {
  return askClaude(client, request, FACT_SUGGESTION_SETTINGS);
}

// Asks Claude to write one marketing plan for the Co-Founder.
// `client` is only replaced by the checks.
export async function askClaudeForMarketingPlan(request: ModelRequest, client = clientFromEnv()): Promise<ModelResult> {
  return askClaude(client, request, MARKETING_PLAN_SETTINGS);
}

// Asks Claude to write one content draft (a post, its hashtags and claims).
// `client` is only replaced by the checks.
export async function askClaudeForContentDraft(request: ModelRequest, client = clientFromEnv()): Promise<ModelResult> {
  return askClaude(client, request, CONTENT_DRAFT_SETTINGS);
}

// Asks Claude to plan the next two weeks of posts (topics, days and times).
// `client` is only replaced by the checks.
export async function askClaudeForCalendarPlan(request: ModelRequest, client = clientFromEnv()): Promise<ModelResult> {
  return askClaude(client, request, CALENDAR_PLAN_SETTINGS);
}

// Asks Claude to review a period of post numbers (findings citing them,
// recommendations). `client` is only replaced by the checks.
export async function askClaudeForPerformanceReview(request: ModelRequest, client = clientFromEnv()): Promise<ModelResult> {
  return askClaude(client, request, PERFORMANCE_REVIEW_SETTINGS);
}

// The one way this file builds a client. Exported for the checks: building
// one makes no network call. Time limits and retries are set per request
// (RequestSettings), never here.
export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    // Never log anything. Left unset, the SDK reads ANTHROPIC_LOG, and at
    // "debug" it prints every request (the transcript slice or email) and every
    // answer; even at "error" it can print raw response chunks.
    logLevel: "off",
    // No tracing either: its ANTHROPIC_OPEN_TELEMETRY_* variables could make
    // traces capture the same content.
    openTelemetry: false,
  });
}

// No API key: nothing is asked, and the caller escalates ("model unavailable").
function clientFromEnv(): Anthropic | null {
  return env.ANTHROPIC_API_KEY ? createClaudeClient(env.ANTHROPIC_API_KEY) : null;
}

async function askClaude(client: Anthropic | null, request: ModelRequest, settings: RequestSettings): Promise<ModelResult> {
  if (!client) {
    return { kind: "unavailable" };
  }
  try {
    // messages.create, not messages.parse: parse throws on an invalid answer,
    // with the answer quoted in the error message. The callers parse it
    // themselves (lib/call-brain/decision.ts, lib/email-triage/result.ts),
    // where invalid simply means escalate, or a ticket without the AI.
    const response = await client.messages.create(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: settings.maxTokens,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          effort: settings.effort,
          format: { type: "json_schema", schema: request.jsonSchema },
        },
      },
      {
        timeout: settings.timeoutMs,
        maxRetries: settings.maxRetries,
        // The per-attempt timeout covers neither the waits between attempts
        // nor reading the answer. Cut off here, the SDK throws, and the
        // caller escalates (or tickets the email without the AI).
        signal: AbortSignal.timeout(longestRequestMs(settings)),
      },
    );
    return readResponse(response);
  } catch (error) {
    return { kind: "error", errorName: nameOfError(error) };
  }
}

function readResponse(response: Anthropic.Message): ModelResult {
  if (response.stop_reason === "refusal") {
    return { kind: "refused" };
  }
  if (response.stop_reason === "max_tokens") {
    return { kind: "truncated" };
  }
  if (response.stop_reason !== "end_turn") {
    return { kind: "unexpected-stop" };
  }
  const outputText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return {
    kind: "ok",
    outputText,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
