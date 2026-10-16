import { z } from "zod";

// Exactly what Claude must return, written twice on purpose:
// - MODEL_DECISION_JSON_SCHEMA is sent to the API, which then only lets Claude
//   produce JSON of this shape. Written by hand because the SDK's Zod
//   converter turns the "outcome" enum into a mere description.
// - modelDecisionSchema is what WE check the answer against afterwards. It
//   also enforces the lengths the API can't (structured outputs don't support
//   minLength / maxLength).
// Keep the two in sync. scripts/tenant-isolation/brain-guard-checks.ts checks it.
//
// There is deliberately no company, call or ticket field: Claude cannot choose
// what its decision applies to. Any extra field makes the answer invalid
// (.strict() / additionalProperties: false), which means escalate.

export const MODEL_DECISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["solved", "needs_human"] },
    customer_issue: { type: "string" },
    resolution_evidence: { type: "string" },
    reason: { type: "string" },
  },
  required: ["outcome", "customer_issue", "resolution_evidence", "reason"],
  additionalProperties: false,
};

export const modelDecisionSchema = z
  .object({
    outcome: z.enum(["solved", "needs_human"]),
    customer_issue: z.string().min(1).max(500),
    resolution_evidence: z.string().max(300),
    reason: z.string().max(500),
  })
  .strict();

export type ModelDecision = z.infer<typeof modelDecisionSchema>;

// Everything that can come back from asking the model. Only "ok" carries
// model text, and that text is never logged.
export type ModelResult =
  | { kind: "ok"; outputText: string; usage: { inputTokens: number; outputTokens: number } }
  | { kind: "refused" }
  | { kind: "truncated" }
  | { kind: "unexpected-stop" }
  | { kind: "error"; errorName: string }
  | { kind: "unavailable" };

// The shape of any function that asks a model for a decision. The real one is
// adapters/claude.ts; the checks pass fakes so they never call the paid API.
export type DecisionAsker = (systemPrompt: string, prompt: string) => Promise<ModelResult>;
