import { z } from "zod";
import type { ModelResult } from "@/lib/call-brain/model-output";

// What Claude must return for an email, written twice like the call brain:
// the JSON schema the API enforces, and the Zod schema we check against.
// Both per company, because "category" may only be one of its active names.

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

export function buildTriageSchema(categoryNames: string[]) {
  const allowedCategories: [string, ...string[]] = ["", ...categoryNames];
  return z
    .object({
      customer_issue: z.string().min(1).max(500),
      ticket_subject: z.string().min(1).max(80),
      category: z.enum(allowedCategories),
    })
    .strict();
}

export type EmailTriage = {
  ticketSubject: string;
  // Claude's summary, or null when Claude gave no usable answer.
  summary: string | null;
  category: string | null;
  usedModel: boolean;
};

// Turns whatever came back from Claude into ticket fields. Anything missing,
// malformed or unexpected falls back to the email's own subject, no summary
// and no category: the email still becomes a ticket for a human.
export function triageFromModelResult(result: ModelResult, emailSubject: string, categoryNames: string[]): EmailTriage {
  const fallback: EmailTriage = {
    ticketSubject: fallbackSubject(emailSubject),
    summary: null,
    category: null,
    usedModel: result.kind !== "unavailable",
  };
  if (result.kind !== "ok") {
    return fallback;
  }
  const parsed = buildTriageSchema(categoryNames).safeParse(parseJsonOrNull(result.outputText));
  if (!parsed.success) {
    return fallback;
  }
  return {
    ticketSubject: parsed.data.ticket_subject,
    summary: parsed.data.customer_issue,
    category: parsed.data.category || null,
    usedModel: true,
  };
}

function fallbackSubject(emailSubject: string): string {
  const cleaned = emailSubject.replace(/\p{Cc}/gu, " ").trim().slice(0, 200);
  return cleaned || "Customer email";
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
