import "server-only";
import { getCallById, getCallsForCompany, insertCallIfNew, type CallListItem } from "@/db/calls";
import { findPhoneLineByVapiNumberId } from "@/db/phone-lines";
import type { DecisionSource } from "@/db/schema";
import { decryptText, encryptText } from "@/lib/encryption";
import { callExplanationContext, callIssueContext, callTranscriptContext } from "@/lib/encryption-contexts";
import type { SessionContext } from "@/lib/session";
import { callIdSchema, type EndOfCallReport } from "@/lib/validation/vapi";
import { canAnalyzeAgain } from "./call-analysis";

// Re-exported so pages can use the type without importing from /db.
export type { CallListItem };

export type CallDetail = CallListItem & {
  transcript: string | null;
  // True when a transcript is stored but could not be decrypted (wrong key, damaged data).
  transcriptUnreadable: boolean;
  analysis: {
    source: DecisionSource | null;
    reasonCode: string | null;
    model: string | null;
    decidedAt: Date | null;
    issue: string | null;
    explanation: string | null;
    // Never analyzed, or the analysis seems to have died.
    canAnalyzeNow: boolean;
  };
};

export type SaveCallOutcome =
  | { outcome: "saved"; companyId: string; callId: string }
  | { outcome: "duplicate" }
  | { outcome: "unknown-phone-line" };

// Saves one finished call for the company that owns the phone line it came in on.
// Only call this with a report whose webhook signature was verified.
export async function saveEndOfCallReport(report: EndOfCallReport): Promise<SaveCallOutcome> {
  const { message } = report;
  // The phone line decides the company. Nothing in the payload is trusted for that.
  const line = await findPhoneLineByVapiNumberId(message.call.phoneNumberId);
  if (!line) {
    return { outcome: "unknown-phone-line" };
  }

  const transcript = message.artifact?.transcript ?? message.transcript ?? null;
  const newCallId = await insertCallIfNew(line.companyId, {
    phoneLineId: line.id,
    vapiCallId: message.call.id,
    callerNumber: message.call.customer?.number ?? null,
    startedAt: message.startedAt ?? message.call.startedAt ?? null,
    endedAt: message.endedAt ?? message.call.endedAt ?? null,
    endedReason: message.endedReason ?? null,
    transcriptEncrypted: transcript
      ? encryptText(transcript, callTranscriptContext(line.companyId, message.call.id))
      : null,
  });
  if (!newCallId) {
    return { outcome: "duplicate" };
  }
  return { outcome: "saved", companyId: line.companyId, callId: newCallId };
}

// Lists the newest calls of the logged-in user's company.
export async function listCallsForSession(session: SessionContext): Promise<CallListItem[]> {
  return getCallsForCompany(session.companyId);
}

// Reads one call of the session's company, decrypting its transcript and the
// brain's notes. Returns null for bad ids and for calls of other companies.
export async function getCallForSession(
  session: SessionContext,
  callId: unknown,
): Promise<CallDetail | null> {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) {
    return null;
  }
  const call = await getCallById(session.companyId, parsed.data);
  if (!call) {
    return null;
  }

  const transcript = decryptOrUnreadable(call.transcriptEncrypted, callTranscriptContext(call.companyId, call.vapiCallId));
  return {
    id: call.id,
    callerNumber: call.callerNumber,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    endedReason: call.endedReason,
    analysisStatus: call.analysisStatus,
    aiOutcome: call.aiOutcome,
    transcript: transcript === "unreadable" ? null : transcript,
    transcriptUnreadable: transcript === "unreadable",
    analysis: {
      source: call.aiDecisionSource,
      reasonCode: call.aiReasonCode,
      model: call.aiModel,
      decidedAt: call.decidedAt,
      issue: readableOrNull(decryptOrUnreadable(call.aiIssueEncrypted, callIssueContext(call.companyId, call.id))),
      explanation: readableOrNull(decryptOrUnreadable(call.aiExplanationEncrypted, callExplanationContext(call.companyId, call.id))),
      canAnalyzeNow: canAnalyzeAgain(call.analysisStatus, call.analysisStartedAt, new Date()),
    },
  };
}

function decryptOrUnreadable(encrypted: string | null, context: string): string | null | "unreadable" {
  if (!encrypted) {
    return null;
  }
  try {
    return decryptText(encrypted, context);
  } catch {
    // Never log the ciphertext or anything from the call.
    console.error("Could not decrypt stored call text");
    return "unreadable";
  }
}

function readableOrNull(value: string | null | "unreadable"): string | null {
  return value === "unreadable" ? null : value;
}
