import "server-only";
import { askClaudeForCallDecision } from "@/adapters/claude";
import {
  claimCallForAnalysis,
  saveCallDecision,
  STALE_ANALYSIS_MINUTES,
  type CallToAnalyze,
} from "@/db/call-analysis";
import { getActiveCategories } from "@/db/categories";
import { decideBeforeAskingModel, decideFromModelResult, escalateByRule, type CallDecision } from "@/lib/call-brain/decision";
import { buildModelDecisionJsonSchema } from "@/lib/call-brain/model-output";
import { buildDecisionPrompt, CALL_DECISION_SYSTEM_PROMPT } from "@/lib/call-brain/prompt";
import { REASON_CODES } from "@/lib/call-brain/reasons";
import { buildTranscriptSlice } from "@/lib/call-brain/transcript-slice";
import { decryptForDisplay, encryptText } from "@/lib/encryption";
import { callEvidenceContext, callExplanationContext, callIssueContext, callTranscriptContext } from "@/lib/encryption-contexts";
import { env } from "@/lib/env";
import type { FormResult } from "@/lib/form-result";
import { describeModelFailure } from "@/lib/model-failure";
import type { ModelAsker } from "@/lib/model-request";
import type { SessionContext } from "@/lib/session";
import { analyzeCallSchema } from "@/lib/validation/vapi";
import { notifyAssignee } from "./assignment-notifications";
import { buildCallTicket } from "./call-tickets";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// LOGGING RULE for this file: never log the transcript, the prompt, the
// model's answer or any error message. Fixed strings and class names only.

export type ComputedDecision = {
  decision: CallDecision;
  askedModel: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
  // Why asking Claude gave no answer ("AuthenticationError", "refused", ...),
  // or null (see lib/model-failure.ts).
  modelFailure: string | null;
};

// Works out the decision for one transcript without saving anything.
// categoryNames: the company's active categories (Claude may only pick one of
// these). Used by analyzeCall and by pnpm try:brain.
export async function computeCallDecision(
  transcript: string | null,
  endedReason: string | null,
  askModel: ModelAsker,
  categoryNames: string[],
): Promise<ComputedDecision> {
  if (!transcript) {
    return { decision: escalateByRule(REASON_CODES.noTranscript), askedModel: false, usage: null, modelFailure: null };
  }
  const slice = buildTranscriptSlice(transcript);
  const ruleDecision = decideBeforeAskingModel(slice, endedReason);
  if (ruleDecision) {
    return { decision: ruleDecision, askedModel: false, usage: null, modelFailure: null };
  }

  // Only the slice and the category names are sent: no company, caller number or ids.
  const result = await askModel({
    systemPrompt: CALL_DECISION_SYSTEM_PROMPT,
    prompt: buildDecisionPrompt(slice, categoryNames),
    jsonSchema: buildModelDecisionJsonSchema(categoryNames),
  });
  return {
    decision: decideFromModelResult(result, slice, categoryNames),
    askedModel: result.kind !== "unavailable",
    usage: result.kind === "ok" ? result.usage : null,
    modelFailure: describeModelFailure(result),
  };
}

// Decides whether one saved call needs a human, stores the decision, and
// creates a ticket for every "needs_human" (step 8).
// companyId must come from a trusted source (the phone line, or a session).
// Never throws. askModel is only replaced by the checks, with a fake.
// "not-claimed": the call is already decided, being analyzed, or not this
// company's. "failed": nothing could be saved, not even the escalation a
// failure falls back to (the call stays "analyzing" until it counts as stuck,
// 5 minutes), or the database failed while claiming the call (it stays as it
// was). Either way "Analyze now" and the daily job can try it again.
export async function analyzeCall(
  companyId: string,
  callId: string,
  askModel: ModelAsker = askClaudeForCallDecision,
): Promise<"decided" | "not-claimed" | "failed"> {
  let call: CallToAnalyze | undefined;
  try {
    call = await claimCallForAnalysis(companyId, callId);
    if (!call) {
      return "not-claimed";
    }

    const transcript = decryptForDisplay(call.transcriptEncrypted, callTranscriptContext(companyId, call.vapiCallId));
    const categories = await getActiveCategories(companyId);
    const computed = transcript.unreadable
      ? { decision: escalateByRule(REASON_CODES.transcriptUnreadable), askedModel: false, usage: null, modelFailure: null }
      : await computeCallDecision(transcript.text, call.endedReason, askModel, categories.map((category) => category.name));
    if (computed.modelFailure) {
      // One fixed line with the class: a revoked key (AuthenticationError) and
      // a wrong model name (NotFoundError) need different fixes.
      console.error(`Claude call failed: ${computed.modelFailure}`);
    }

    // The category by id, so an owner renaming it while Claude thought is followed.
    const categoryId = categories.find((category) => category.name === computed.decision.category)?.id ?? null;
    await storeDecision(companyId, callId, call.callerNumber, computed, categoryId);
    return "decided";
  } catch (error) {
    console.error(`Call analysis failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    // No call means the claim itself threw (a claim that finds nothing
    // returned "not-claimed" above): a failure, not "already analyzed".
    return call ? storeFallbackDecision(companyId, callId, call.callerNumber) : "failed";
  }
}

// After a failure, still records an escalation (and its ticket) if it can,
// so the call is never left without a decision. Says whether that worked.
async function storeFallbackDecision(companyId: string, callId: string, callerNumber: string | null): Promise<"decided" | "failed"> {
  const fallback = { decision: escalateByRule(REASON_CODES.analysisError), askedModel: false, usage: null, modelFailure: null };
  try {
    await storeDecision(companyId, callId, callerNumber, fallback, null);
    return "decided";
  } catch {
    console.error("Could not store the fallback decision");
    return "failed";
  }
}

// "Analyze now" on the call page, for a call that was never analyzed or whose
// analysis seems to have died. Anyone in the company may do this. askModel is
// only replaced by the checks, with a fake.
export async function analyzeCallForSession(
  session: SessionContext,
  input: unknown,
  askModel: ModelAsker = askClaudeForCallDecision,
): Promise<FormResult> {
  const parsed = analyzeCallSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown call." } };
  }
  // Each analysis is a paid API call.
  if (await isOverRateLimit("call-analysis", session.userId, RATE_LIMITS.callAnalysisPerUser)) {
    return { ok: false, errors: { message: "Too many analyses. Try again in a few minutes." } };
  }
  const outcome = await analyzeCall(session.companyId, parsed.data.callId, askModel);
  if (outcome === "not-claimed") {
    return { ok: false, errors: { message: "This call is already analyzed or being analyzed." } };
  }
  if (outcome === "failed") {
    return { ok: false, errors: { message: "The analysis failed and nothing could be saved. Try again in a few minutes." } };
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

// Saves one call's decision and a "needs_human"'s ticket in one transaction
// (Claude's text encrypted first), then emails whoever routing gave it to.
async function storeDecision(
  companyId: string,
  callId: string,
  callerNumber: string | null,
  computed: Pick<ComputedDecision, "decision" | "askedModel" | "modelFailure">,
  categoryId: string | null,
) {
  const { decision } = computed;
  // Only for a failed request: "refused" and the like have reason codes of their own.
  const errorClass = decision.reasonCode === REASON_CODES.modelError ? computed.modelFailure : null;
  const ticket = decision.outcome === "needs_human" ? { ...buildCallTicket(decision, callerNumber, errorClass), categoryId } : null;
  const saved = await saveCallDecision(companyId, callId, {
    outcome: decision.outcome,
    source: decision.source,
    reasonCode: decision.reasonCode,
    model: computed.askedModel ? env.ANTHROPIC_MODEL : null,
    errorClass,
    issueEncrypted: decision.customerIssue
      ? encryptText(decision.customerIssue, callIssueContext(companyId, callId))
      : null,
    explanationEncrypted: decision.explanation
      ? encryptText(decision.explanation, callExplanationContext(companyId, callId))
      : null,
    // Kept so whoever reviews a "solved" call sees the customer's own words (step 31).
    evidenceEncrypted: decision.resolutionEvidence
      ? encryptText(decision.resolutionEvidence, callEvidenceContext(companyId, callId))
      : null,
  }, ticket);

  // After the transaction: tell whoever routing picked (step 13).
  if (saved.ticketId && saved.assignedToUserId) {
    await notifyAssignee({ companyId, ticketId: saved.ticketId, assigneeUserId: saved.assignedToUserId, assignedByUserId: null });
  }
}
