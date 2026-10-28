import { z } from "zod";
import { redactCardNumbers } from "@/lib/card-numbers";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelResult } from "@/lib/model-request";
import { toPlainSingleLine } from "@/lib/plain-text";

const MAX_FALLBACK_SUBJECT_CHARACTERS = 200;

// What Claude must return for an email, written twice like the call brain:
// the JSON schema the API enforces, and the Zod schema we check against.
// Both per company, because "category" may only be one of its active names.
// Keep the two in sync: scripts/tenant-isolation/claude-adapter-checks.ts
// checks it.

export function buildTriageJsonSchema(categoryNames: string[]) {
  return {
    type: "object",
    properties: {
      customer_issue: { type: "string" },
      ticket_subject: { type: "string" },
      category: { type: "string", enum: [...categoryNames, ""] },
    },
    required: ["customer_issue", "ticket_subject", "category"],
    additionalProperties: false,
  };
}

// Text that is too long is cut to fit instead of refused (step 27): triage has
// no "solved" to protect, and a few characters too many must not cost the
// summary and the category routing needs. Blank is allowed here;
// triageFromModelResult fills in. Extra fields and unknown categories are
// still refused.
export function buildTriageSchema(categoryNames: string[]) {
  const allowedCategories: [string, ...string[]] = ["", ...categoryNames];
  return z
    .object({
      customer_issue: z.string().transform((text) => text.trim().slice(0, 500).trim()),
      ticket_subject: z.string().transform((text) => toPlainSingleLine(text).slice(0, 80).trim()),
      category: z.enum(allowedCategories),
    })
    .strict();
}

export type EmailTriage = {
  ticketSubject: string;
  // Claude's summary, or null when Claude gave no usable answer.
  summary: string | null;
  category: string | null;
  // Why the ticket has no AI summary or category, in a few words for the
  // ticket ("the AI could not be reached (AuthenticationError)"); null when
  // Claude answered.
  missingAiReason: string | null;
};

// Turns whatever came back from Claude into ticket fields. Anything missing,
// malformed or unexpected falls back to the email's own subject, no summary
// and no category, with the reason: the email still becomes a ticket.
export function triageFromModelResult(result: ModelResult, emailSubject: string, categoryNames: string[]): EmailTriage {
  if (result.kind !== "ok") {
    return triageWithoutModel(emailSubject, describeMissingAnswer(result));
  }
  const parsed = buildTriageSchema(categoryNames).safeParse(parseJsonOrNull(result.outputText));
  if (!parsed.success) {
    return triageWithoutModel(emailSubject, "Claude's answer was malformed");
  }
  return {
    ticketSubject: parsed.data.ticket_subject || fallbackSubject(emailSubject),
    summary: parsed.data.customer_issue || null,
    category: parsed.data.category || null,
    missingAiReason: null,
  };
}

// Ticket fields made without Claude: the email's own subject, no summary and
// no category, and why (shown on the ticket).
export function triageWithoutModel(emailSubject: string, missingAiReason: string): EmailTriage {
  return { ticketSubject: fallbackSubject(emailSubject), summary: null, category: null, missingAiReason };
}

function describeMissingAnswer(result: Exclude<ModelResult, { kind: "ok" }>): string {
  if (result.kind === "unavailable") {
    return "no Claude API key is set";
  }
  if (result.kind === "error") {
    return `the AI could not be reached (${describeModelFailure(result)})`;
  }
  if (result.kind === "refused") {
    return "Claude declined to answer";
  }
  if (result.kind === "truncated") {
    return "Claude's answer was cut off";
  }
  return "Claude's answer stopped early";
}

// The ticket subject when Claude gave no usable answer: the email's own
// subject, written by whoever sent it. It is stored plainly, listed on the
// dashboard and sent in assignment emails, so it gets the same clean-up as
// Claude's view of it: one plain line (no hidden right-to-left tricks), card
// numbers redacted BEFORE the length cap (so a cut can't leave half a number
// unredacted), at most 200 characters (the ticket subject limit).
export function fallbackSubject(emailSubject: string): string {
  const oneLine = toPlainSingleLine(emailSubject);
  const redacted = redactCardNumbers(oneLine);
  const capped = redacted.slice(0, MAX_FALLBACK_SUBJECT_CHARACTERS).trim();
  return capped || "Customer email";
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
