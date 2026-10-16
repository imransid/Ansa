import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { DecisionRequest, ModelResult } from "@/lib/call-brain/model-output";
import { env } from "@/lib/env";

// Translates "decide this call" into one Claude API request.
//
// LOGGING RULE: the prompt holds part of a call transcript and the response
// is model text about it. Neither is ever logged, and neither are SDK error
// messages (they can quote the response). Only error class names leave here.
//
// No refusal fallback on purpose: if the chosen model declines, the call is
// escalated. One predictable path, no model we didn't pick.

// Thinking tokens count toward this, so leave room beyond the short JSON answer.
const MAX_TOKENS = 8_000;

export async function askClaudeForCallDecision({ systemPrompt, prompt, jsonSchema }: DecisionRequest): Promise<ModelResult> {
  if (!env.ANTHROPIC_API_KEY) {
    return { kind: "unavailable" };
  }

  // 60 s per attempt, 2 retries (the SDK retries 429, 5xx and network errors).
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 });
  try {
    // messages.create, not messages.parse: parse throws on an invalid answer,
    // with the answer quoted in the error message. We parse it ourselves in
    // lib/call-brain/decision.ts, where invalid simply means escalate.
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        // A wrong "solved" is the expensive mistake, so think it through.
        effort: "high",
        format: { type: "json_schema", schema: jsonSchema },
      },
    });

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
  } catch (error) {
    return { kind: "error", errorName: error instanceof Error ? error.constructor.name : "unknown" };
  }
}
