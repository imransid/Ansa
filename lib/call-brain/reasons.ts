// Why the call brain decided what it did: the fixed codes stored on the call
// (calls.ai_reason_code, never model text) and the sentences the call page
// and the call's ticket show for them.

export const REASON_CODES = {
  modelSolved: "model_solved",
  modelNeedsHuman: "model_needs_human",
  // Claude's needs_human answer was only a little too long, or had a blank
  // subject: kept, cut to fit (step 27). Never used for "solved".
  trimmedOutput: "trimmed_output",
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

export const REASON_LABELS: Record<ReasonCode, string> = {
  model_solved: "Claude judged it solved, and the customer confirmed it in their own words.",
  model_needs_human: "Claude judged that a human needs to follow up.",
  trimmed_output: "Claude judged that a human needs to follow up (its answer was a little too long, so it was shortened).",
  unverified_resolution: "Claude said solved, but no whole sentence in the customer's last two turns (the call's first four turns don't count) confirms it, so it was escalated.",
  invalid_output: "Claude's answer was malformed, so the call was escalated.",
  model_refused: "Claude declined to answer, so the call was escalated.",
  model_truncated: "Claude's answer was cut off, so the call was escalated.",
  model_error: "The AI could not be reached, so the call was escalated.",
  model_unavailable: "No Claude API key is set, so the call was escalated.",
  no_transcript: "The call has no transcript, so it was escalated.",
  no_customer_speech: "The customer never spoke, so the call was escalated.",
  abnormal_end: "The call ended abnormally, so it was escalated.",
  transcript_unreadable: "The transcript could not be decrypted, so the call was escalated.",
  analysis_error: "Something went wrong while analyzing, so the call was escalated.",
};

// Claude was asked but gave no usable answer: a rule escalated the call, not
// Claude's judgement, so the call page doesn't say "decided by Claude".
const MODEL_FAILURE_REASON_CODES: readonly string[] = [
  REASON_CODES.invalidOutput,
  REASON_CODES.modelRefused,
  REASON_CODES.modelTruncated,
  REASON_CODES.modelError,
];

export function isModelFailureReason(reasonCode: string | null): boolean {
  return reasonCode !== null && MODEL_FAILURE_REASON_CODES.includes(reasonCode);
}

// The sentence for a reason code. For a failed request it names the error's
// class when one was recorded ("The AI could not be reached
// (AuthenticationError), ..."): a revoked key and a wrong model name need
// different fixes. "-" for a code this version doesn't know.
export function describeReason(reasonCode: string | null, errorClass: string | null = null): string {
  if (reasonCode === REASON_CODES.modelError && errorClass) {
    return `The AI could not be reached (${errorClass}), so the call was escalated.`;
  }
  if (reasonCode && Object.hasOwn(REASON_LABELS, reasonCode)) {
    return REASON_LABELS[reasonCode as ReasonCode];
  }
  return "-";
}
