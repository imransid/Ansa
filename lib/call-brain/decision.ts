import type { CallOutcome, DecisionSource } from "@/db/schema";
import type { ModelResult } from "@/lib/model-request";
import { buildModelDecisionSchema, buildNeedsHumanSalvageSchema } from "./model-output";
import { REASON_CODES, type ReasonCode } from "./reasons";
import { findCustomerConfirmation } from "./resolution-evidence";
import type { TranscriptSlice } from "./transcript-slice";

// The guards between Claude and the database. The one rule: anything
// missing, malformed, unexpected or unproven becomes "needs_human".
// Nothing here can ever turn a failure into "solved".

export type CallDecision = {
  outcome: CallOutcome;
  source: DecisionSource;
  reasonCode: ReasonCode;
  // From Claude, only when Claude gave a valid answer.
  customerIssue: string | null;
  explanation: string | null;
  ticketSubject: string | null;
  // One of the company's active categories, or null (step 10).
  category: string | null;
  // "solved" only: the customer's confirming sentence that passed the check
  // (resolution-evidence.ts), as the transcript has it (step 31).
  resolutionEvidence: string | null;
};

// Vapi end reasons that mean the call did not finish normally. Escalate them
// without asking Claude.
const ABNORMAL_END = /error|fail|timed-out|timeout|voicemail|forward|transfer|exceeded|did-not-answer|no-answer|busy/i;

// Decides cases that need no model at all. Returns null when Claude should be asked.
export function decideBeforeAskingModel(slice: TranscriptSlice, endedReason: string | null): CallDecision | null {
  if (slice.opening.length === 0) {
    return escalateByRule(REASON_CODES.noTranscript);
  }
  if (slice.customerTurnCount === 0) {
    return escalateByRule(REASON_CODES.noCustomerSpeech);
  }
  if (endedReason && ABNORMAL_END.test(endedReason)) {
    return escalateByRule(REASON_CODES.abnormalEnd);
  }
  return null;
}

// Turns whatever came back from the model into a decision.
// categoryNames: the company's active categories, the only allowed values.
export function decideFromModelResult(result: ModelResult, slice: TranscriptSlice, categoryNames: string[]): CallDecision {
  switch (result.kind) {
    case "unavailable":
      return escalateByRule(REASON_CODES.modelUnavailable);
    case "refused":
      return escalateAfterModel(REASON_CODES.modelRefused);
    case "truncated":
      return escalateAfterModel(REASON_CODES.modelTruncated);
    case "unexpected-stop":
      return escalateAfterModel(REASON_CODES.invalidOutput);
    case "error":
      return escalateAfterModel(REASON_CODES.modelError);
    case "ok":
      return decideFromModelText(result.outputText, slice, categoryNames);
  }
}

function decideFromModelText(outputText: string, slice: TranscriptSlice, categoryNames: string[]): CallDecision {
  const json = parseJsonOrNull(outputText);
  const parsed = buildModelDecisionSchema(categoryNames).safeParse(json);
  if (!parsed.success) {
    return salvageNeedsHuman(json, categoryNames) ?? escalateAfterModel(REASON_CODES.invalidOutput);
  }

  const answer = parsed.data;
  if (answer.outcome === "needs_human") {
    return {
      outcome: "needs_human",
      source: "model",
      reasonCode: REASON_CODES.modelNeedsHuman,
      customerIssue: answer.customer_issue,
      explanation: answer.reason,
      ticketSubject: answer.ticket_subject,
      category: answer.category || null,
      resolutionEvidence: null,
    };
  }

  // "solved" must be backed by one whole sentence of the customer's, from
  // their last two turns of exactly what Claude was shown (see
  // resolution-evidence.ts). A made-up quote, a paraphrase, a piece of a
  // sentence, a question or words the agent said do not count.
  const confirmation = findCustomerConfirmation(answer.resolution_evidence, slice);
  if (confirmation === null) {
    return {
      outcome: "needs_human",
      source: "model",
      reasonCode: REASON_CODES.unverifiedResolution,
      customerIssue: answer.customer_issue,
      explanation: null,
      ticketSubject: answer.ticket_subject,
      category: answer.category || null,
      resolutionEvidence: null,
    };
  }
  return {
    outcome: "solved",
    source: "model",
    reasonCode: REASON_CODES.modelSolved,
    customerIssue: answer.customer_issue,
    explanation: answer.reason,
    ticketSubject: null,
    category: null,
    resolutionEvidence: confirmation,
  };
}

// A "needs_human" answer the strict schema refused only because a field was a
// little too long or the subject blank (see buildNeedsHumanSalvageSchema):
// still Claude's judgement, cut to fit. Never returns "solved". null when the
// answer is broken in any other way.
function salvageNeedsHuman(json: unknown, categoryNames: string[]): CallDecision | null {
  const salvaged = buildNeedsHumanSalvageSchema(categoryNames).safeParse(json);
  if (!salvaged.success) {
    return null;
  }
  const answer = salvaged.data;
  return {
    outcome: "needs_human",
    source: "model",
    reasonCode: REASON_CODES.trimmedOutput,
    customerIssue: answer.customer_issue || null,
    explanation: answer.reason || null,
    ticketSubject: answer.ticket_subject || null,
    category: answer.category || null,
    resolutionEvidence: null,
  };
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The fields only a valid answer from Claude fills in.
const NOTHING_FROM_CLAUDE = {
  customerIssue: null,
  explanation: null,
  ticketSubject: null,
  category: null,
  resolutionEvidence: null,
} as const;

export function escalateByRule(reasonCode: ReasonCode): CallDecision {
  return { outcome: "needs_human", source: "rule", reasonCode, ...NOTHING_FROM_CLAUDE };
}

function escalateAfterModel(reasonCode: ReasonCode): CallDecision {
  return { outcome: "needs_human", source: "model", reasonCode, ...NOTHING_FROM_CLAUDE };
}
