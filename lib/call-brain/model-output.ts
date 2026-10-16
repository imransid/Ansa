import { z } from "zod";

// Exactly what Claude must return, written twice on purpose:
// - buildModelDecisionJsonSchema is sent to the API, which then only lets
//   Claude produce JSON of this shape. Written by hand because the SDK's Zod
//   converter turns enums into mere descriptions.
// - buildModelDecisionSchema is what WE check the answer against afterwards.
//   It also enforces the lengths the API can't (structured outputs don't
//   support minLength / maxLength).
// Keep the two in sync. scripts/tenant-isolation/brain-guard-checks.ts checks it.
//
// Both are built per company, because "category" may only be one of that
// company's active category names, or "" for none (step 10).
//
// There is deliberately no company, call or ticket field: Claude cannot choose
// what its decision applies to. Any extra field makes the answer invalid
// (.strict() / additionalProperties: false), which means escalate.

export function buildModelDecisionJsonSchema(categoryNames: string[]) {
  return {
    type: "object",
    properties: {
      outcome: { type: "string", enum: ["solved", "needs_human"] },
      customer_issue: { type: "string" },
      resolution_evidence: { type: "string" },
      reason: { type: "string" },
      ticket_subject: { type: "string" },
      category: { type: "string", enum: [...categoryNames, ""] },
    },
    required: ["outcome", "customer_issue", "resolution_evidence", "reason", "ticket_subject", "category"],
    additionalProperties: false,
  };
}

export function buildModelDecisionSchema(categoryNames: string[]) {
  const allowedCategories: [string, ...string[]] = ["", ...categoryNames];
  return z
    .object({
      outcome: z.enum(["solved", "needs_human"]),
      customer_issue: z.string().min(1).max(500),
      resolution_evidence: z.string().max(300),
      reason: z.string().max(500),
      // Becomes the subject of the follow-up ticket (step 8).
      ticket_subject: z.string().min(1).max(80),
      // Decides who the ticket is routed to (step 10). "" = none fits.
      category: z.enum(allowedCategories),
    })
    .strict();
}

export type ModelDecision = z.infer<ReturnType<typeof buildModelDecisionSchema>>;

// Everything that can come back from asking the model. Only "ok" carries
// model text, and that text is never logged.
export type ModelResult =
  | { kind: "ok"; outputText: string; usage: { inputTokens: number; outputTokens: number } }
  | { kind: "refused" }
  | { kind: "truncated" }
  | { kind: "unexpected-stop" }
  | { kind: "error"; errorName: string }
  | { kind: "unavailable" };

export type DecisionRequest = {
  systemPrompt: string;
  prompt: string;
  jsonSchema: ReturnType<typeof buildModelDecisionJsonSchema>;
};

// The shape of any function that asks a model for a decision. The real one is
// adapters/claude.ts; the checks pass fakes so they never call the paid API.
export type DecisionAsker = (request: DecisionRequest) => Promise<ModelResult>;
