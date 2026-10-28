import { z } from "zod";
import { MAX_TURN_CHARACTERS } from "./transcript-slice";

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
      customer_issue: z.string().trim().min(1).max(500),
      // One whole sentence of a turn (resolution-evidence.ts), so at most a
      // whole turn: a long run-on sentence must reach that check, not be
      // refused as malformed. Claude's copy is only compared there; when it
      // passes, the transcript's own sentence is kept, encrypted on the call,
      // and shown on the call page (step 31).
      resolution_evidence: z.string().max(MAX_TURN_CHARACTERS),
      reason: z.string().max(500),
      // Becomes the subject of the follow-up ticket (step 8). Blank counts as
      // missing: the ticket schema would refuse it later anyway.
      ticket_subject: z.string().trim().min(1).max(80),
      // Decides who the ticket is routed to (step 10). "" = none fits.
      category: z.enum(allowedCategories),
    })
    .strict();
}

export type ModelDecision = z.infer<ReturnType<typeof buildModelDecisionSchema>>;

// A second, looser reading of an answer the schema above refused (step 27),
// for "needs_human" ONLY: a subject, issue or reason a little over its length
// is cut to fit, and a blank subject or issue becomes "" (the ticket then gets
// the fallback subject), instead of throwing Claude's whole answer away (its
// summary and the category routing needs). Everything else stays as strict:
// every field present, no extra field, a known category. A "solved" answer
// never gets this second chance (outcome must be "needs_human").
export function buildNeedsHumanSalvageSchema(categoryNames: string[]) {
  const allowedCategories: [string, ...string[]] = ["", ...categoryNames];
  return z
    .object({
      outcome: z.literal("needs_human"),
      customer_issue: cutToLength(500),
      resolution_evidence: z.string(),
      reason: cutToLength(500),
      ticket_subject: cutToLength(80),
      category: z.enum(allowedCategories),
    })
    .strict();
}

function cutToLength(maxLength: number) {
  return z.string().transform((text) => text.trim().slice(0, maxLength).trim());
}
