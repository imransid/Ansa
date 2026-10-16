import type { CallOutcome, DecisionSource } from "@/db/schema";
import { buildModelDecisionSchema, type ModelResult } from "./model-output";
import type { TranscriptSlice } from "./transcript-slice";

// The guards between Claude and the database. The one rule: anything
// missing, malformed, unexpected or unproven becomes "needs_human".
// Nothing here can ever turn a failure into "solved".

export const REASON_CODES = {
  modelSolved: "model_solved",
  modelNeedsHuman: "model_needs_human",
  unverifiedResolution: "unverified_resolution",
  invalidOutput: "invalid_output",
  modelRefused: "model_refused",
  modelTruncated: "model_truncated",
  modelError: "model_error",
  modelUnavailable: "model_unavailable",
  noTranscript: "no_transcript",
  noCustomerSpeech: "no_customer_speech",
  abnormalEnd: "abnormal_end",
  transcriptUnreadable: "transcript_unreadable",
  analysisError: "analysis_error",
} as const;

export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES];

// Shown on the call page.
export const REASON_LABELS: Record<ReasonCode, string> = {
  model_solved: "Claude judged it solved, and the customer confirmed it in their own words.",
  model_needs_human: "Claude judged that a human needs to follow up.",
  unverified_resolution: "Claude said solved, but the customer's confirmation could not be found in the call, so it was escalated.",
  invalid_output: "Claude's answer was malformed, so the call was escalated.",
  model_refused: "Claude declined to answer, so the call was escalated.",
  model_truncated: "Claude's answer was cut off, so the call was escalated.",
  model_error: "Claude could not be reached, so the call was escalated.",
  model_unavailable: "No Claude API key is set, so the call was escalated.",
  no_transcript: "The call has no transcript, so it was escalated.",
  no_customer_speech: "The customer never spoke, so the call was escalated.",
  abnormal_end: "The call ended abnormally, so it was escalated.",
  transcript_unreadable: "The transcript could not be decrypted, so the call was escalated.",
  analysis_error: "Something went wrong while analyzing, so the call was escalated.",
};

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
  const parsed = buildModelDecisionSchema(categoryNames).safeParse(parseJsonOrNull(outputText));
  if (!parsed.success) {
    return escalateAfterModel(REASON_CODES.invalidOutput);
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
    };
  }

  // "solved" must be backed by the customer's own words, found in a customer
  // turn of exactly what Claude was shown. A made-up quote, a paraphrase, or
  // words the agent said do not count.
  if (!isCustomerQuote(answer.resolution_evidence, slice)) {
    return {
      outcome: "needs_human",
      source: "model",
      reasonCode: REASON_CODES.unverifiedResolution,
      customerIssue: answer.customer_issue,
      explanation: null,
      ticketSubject: answer.ticket_subject,
      category: answer.category || null,
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
  };
}

const MIN_EVIDENCE_WORDS = 2;

function isCustomerQuote(evidence: string, slice: TranscriptSlice): boolean {
  const quote = normalizeForMatching(evidence);
  if (quote.split(" ").filter(Boolean).length < MIN_EVIDENCE_WORDS) {
    return false;
  }
  return [...slice.opening, ...slice.closing].some(
    (turn) => turn.speaker === "customer" && normalizeForMatching(turn.text).includes(quote),
  );
}

// Ignores case, curly quotes, extra spaces and punctuation at the quote's edges.
function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'.,!?\s]+|["'.,!?\s]+$/g, "");
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function escalateByRule(reasonCode: ReasonCode): CallDecision {
  return { outcome: "needs_human", source: "rule", reasonCode, customerIssue: null, explanation: null, ticketSubject: null, category: null };
}

function escalateAfterModel(reasonCode: ReasonCode): CallDecision {
  return { outcome: "needs_human", source: "model", reasonCode, customerIssue: null, explanation: null, ticketSubject: null, category: null };
}
