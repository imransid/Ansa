import "server-only";
import { askClaudeForCallDecision } from "@/adapters/claude";
import { claimCallForAnalysis, saveCallDecision, STALE_ANALYSIS_MINUTES } from "@/db/call-analysis";
import {
  decideBeforeAskingModel,
  decideFromModelResult,
  escalateByRule,
  REASON_CODES,
  type CallDecision,
} from "@/lib/call-brain/decision";
import type { DecisionAsker } from "@/lib/call-brain/model-output";
import { buildDecisionPrompt, CALL_DECISION_SYSTEM_PROMPT } from "@/lib/call-brain/prompt";
import { buildTranscriptSlice } from "@/lib/call-brain/transcript-slice";
import { decryptText, encryptText } from "@/lib/encryption";
import { callExplanationContext, callIssueContext, callTranscriptContext } from "@/lib/encryption-contexts";
import { env } from "@/lib/env";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { analyzeCallSchema } from "@/lib/validation/vapi";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE for this file: never log the transcript, the prompt, the
// model's answer or any error message. Fixed strings and class names only.

export type ComputedDecision = {
  decision: CallDecision;
  askedModel: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
};

// Works out the decision for one transcript without saving anything.
// Used by analyzeCall and by pnpm try:brain.
export async function computeCallDecision(
  transcript: string | null,
  endedReason: string | null,
  askModel: DecisionAsker,
): Promise<ComputedDecision> {
  if (!transcript) {
    return { decision: escalateByRule(REASON_CODES.noTranscript), askedModel: false, usage: null };
  }
  const slice = buildTranscriptSlice(transcript);
  const ruleDecision = decideBeforeAskingModel(slice, endedReason);
  if (ruleDecision) {
    return { decision: ruleDecision, askedModel: false, usage: null };
  }

  // Only the slice is sent: no company, caller number or ids.
  const result = await askModel(CALL_DECISION_SYSTEM_PROMPT, buildDecisionPrompt(slice));
  return {
    decision: decideFromModelResult(result, slice),
    askedModel: result.kind !== "unavailable",
    usage: result.kind === "ok" ? result.usage : null,
  };
}

// Decides whether one saved call needs a human, and stores the decision.
// companyId must come from a trusted source (the phone line, or a session).
// Never throws. askModel is only replaced by the checks, with a fake.
export async function analyzeCall(
  companyId: string,
  callId: string,
  askModel: DecisionAsker = askClaudeForCallDecision,
): Promise<"decided" | "not-claimed"> {
  let claimed = false;
  try {
    const call = await claimCallForAnalysis(companyId, callId);
    if (!call) {
      return "not-claimed";
    }
    claimed = true;

    const transcript = decryptTranscriptOrNull(companyId, call.vapiCallId, call.transcriptEncrypted);
    const computed = transcript === "unreadable"
      ? { decision: escalateByRule(REASON_CODES.transcriptUnreadable), askedModel: false }
      : await computeCallDecision(transcript, call.endedReason, askModel);

    await storeDecision(companyId, callId, computed.decision, computed.askedModel);
    return "decided";
  } catch (error) {
    console.error(`Call analysis failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    // Still record an escalation if we can, so the call is never left without a decision.
    if (claimed) {
      await storeDecision(companyId, callId, escalateByRule(REASON_CODES.analysisError), false).catch(() => {
        console.error("Could not store the fallback decision");
      });
    }
    return claimed ? "decided" : "not-claimed";
  }
}

// "Analyze now" on the call page, for a call that was never analyzed or whose
// analysis seems to have died. Anyone in the company may do this.
export async function analyzeCallForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = analyzeCallSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown call." } };
  }
  // Each analysis is a paid API call.
  if (await isOverRateLimit("call-analysis", session.userId, RATE_LIMITS.callAnalysisPerUser)) {
    return { ok: false, errors: { message: "Too many analyses. Try again in a few minutes." } };
  }
  const outcome = await analyzeCall(session.companyId, parsed.data.callId);
  if (outcome === "not-claimed") {
    return { ok: false, errors: { message: "This call is already analyzed or being analyzed." } };
  }
  return { ok: true };
}

// Says whether "Analyze now" makes sense: never analyzed, or stuck analyzing.
export function canAnalyzeAgain(status: string, analysisStartedAt: Date | null, now: Date): boolean {
  if (status === "pending") {
    return true;
  }
  if (status !== "analyzing" || !analysisStartedAt) {
    return false;
  }
  return now.getTime() - analysisStartedAt.getTime() > STALE_ANALYSIS_MINUTES * 60 * 1000;
}

function decryptTranscriptOrNull(companyId: string, vapiCallId: string, encrypted: string | null): string | null | "unreadable" {
  if (!encrypted) {
    return null;
  }
  try {
    return decryptText(encrypted, callTranscriptContext(companyId, vapiCallId));
  } catch {
    return "unreadable";
  }
}

async function storeDecision(companyId: string, callId: string, decision: CallDecision, askedModel: boolean) {
  await saveCallDecision(companyId, callId, {
    outcome: decision.outcome,
    source: decision.source,
    reasonCode: decision.reasonCode,
    model: askedModel ? env.ANTHROPIC_MODEL : null,
    issueEncrypted: decision.customerIssue
      ? encryptText(decision.customerIssue, callIssueContext(companyId, callId))
      : null,
    explanationEncrypted: decision.explanation
      ? encryptText(decision.explanation, callExplanationContext(companyId, callId))
      : null,
  });
}
