import "server-only";
import { STALE_ANALYSIS_MINUTES } from "@/db/call-analysis";
import {
  countCallsPerOutcome,
  getCallById,
  getCallsForCompany,
  insertCallIfNew,
  type CallListRow,
  type CallOutcomeCounts,
} from "@/db/calls";
import { findPhoneLineByVapiNumberId } from "@/db/phone-lines";
import type { DecisionSource, RecordingStatus } from "@/db/schema";
import { getTicketNumberForCall } from "@/db/tickets";
import { decryptForDisplay, encryptText } from "@/lib/encryption";
import { callEvidenceContext, callExplanationContext, callIssueContext, callTranscriptContext } from "@/lib/encryption-contexts";
import type { SessionContext } from "@/lib/session";
import type { CallListQuery } from "@/lib/validation/list-queries";
import { callIdSchema, type EndOfCallReport } from "@/lib/validation/vapi";
import { canAnalyzeAgain } from "./call-analysis";

// Re-exported so pages can use the type without importing from /db.
export type { CallOutcomeCounts };

// One call as the Calls list shows it.
export type CallListItem = CallListRow;

// Every call, unfiltered: what the checks and older callers list.
const EVERY_CALL: CallListQuery = { outcome: "all", search: null };

export type CallDetail = CallListItem & {
  transcript: string | null;
  // True when a transcript is stored but could not be decrypted (wrong key, damaged data).
  transcriptUnreadable: boolean;
  recordingStatus: RecordingStatus;
  // The ticket created from this call (step 8), if any.
  ticketNumber: number | null;
  // Who escalated this call although the AI marked it solved, and when
  // (step 31), or null.
  escalation: { byName: string | null; at: Date } | null;
  analysis: {
    source: DecisionSource | null;
    reasonCode: string | null;
    model: string | null;
    decidedAt: Date | null;
    issue: string | null;
    explanation: string | null;
    // When asking Claude failed: the error's class ("AuthenticationError").
    errorClass: string | null;
    // "solved" only: the customer's sentence that confirmed it (step 31).
    // Null for calls decided before step 31, and when it can't be decrypted.
    evidence: string | null;
    // Never analyzed, or the analysis seems to have died.
    canAnalyzeNow: boolean;
    // The AI marked it solved and it has no ticket yet: "Escalate to a
    // ticket" is offered (step 31). The escalation itself checks again.
    canEscalate: boolean;
  };
};

export type SaveCallOutcome =
  // recordingUrl is only handed on so the webhook can copy the file; it is never stored.
  | { outcome: "saved"; companyId: string; callId: string; recordingUrl: string | null }
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
  const recordingUrl =
    message.artifact?.recording?.mono?.combinedUrl ?? message.artifact?.recordingUrl ?? message.recordingUrl ?? null;
  return { outcome: "saved", companyId: line.companyId, callId: newCallId, recordingUrl };
}

// Lists one page of the logged-in user's company's calls with one filter
// (what the AI decided) and an optional caller number search, newest first.
export async function listCallsForSession(session: SessionContext, page = 1, query: CallListQuery = EVERY_CALL): Promise<CallListItem[]> {
  return getCallsForCompany(session.companyId, { outcome: query.outcome, search: query.search }, page);
}

// Counts the logged-in user's company's calls under every filter, with the
// same search, for the filter links ("Stuck (2)") and "Page x of y".
export async function countCallsPerOutcomeForSession(session: SessionContext, search: string | null = null): Promise<CallOutcomeCounts> {
  return countCallsPerOutcome(session.companyId, search);
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

  const transcript = decryptForDisplay(call.transcriptEncrypted, callTranscriptContext(call.companyId, call.vapiCallId));
  const ticketNumber = await getTicketNumberForCall(session.companyId, call.id);
  return {
    id: call.id,
    callerNumber: call.callerNumber,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    endedReason: call.endedReason,
    analysisStatus: call.analysisStatus,
    aiOutcome: call.aiOutcome,
    createdAt: call.createdAt,
    analysisStartedAt: call.analysisStartedAt,
    analysisStuck: isAnalysisStuck(call, new Date()),
    escalatedAt: call.escalatedAt,
    transcript: transcript.text,
    transcriptUnreadable: transcript.unreadable,
    recordingStatus: call.recordingStatus,
    ticketNumber,
    escalation: call.escalatedAt ? { byName: call.escalatedByName, at: call.escalatedAt } : null,
    analysis: {
      source: call.aiDecisionSource,
      reasonCode: call.aiReasonCode,
      model: call.aiModel,
      decidedAt: call.decidedAt,
      issue: decryptForDisplay(call.aiIssueEncrypted, callIssueContext(call.companyId, call.id)).text,
      explanation: decryptForDisplay(call.aiExplanationEncrypted, callExplanationContext(call.companyId, call.id)).text,
      errorClass: call.aiErrorClass,
      evidence: decryptForDisplay(call.aiEvidenceEncrypted, callEvidenceContext(call.companyId, call.id)).text,
      canAnalyzeNow: canAnalyzeAgain(call.analysisStatus, call.analysisStartedAt, new Date()),
      canEscalate: canEscalate(call, ticketNumber),
    },
  };
}

// A call the AI decided "solved", not escalated yet, without a ticket.
function canEscalate(call: Pick<CallListRow, "analysisStatus" | "aiOutcome" | "escalatedAt">, ticketNumber: number | null): boolean {
  return call.analysisStatus === "decided" && call.aiOutcome === "solved" && call.escalatedAt === null && ticketNumber === null;
}

// A call still not decided 5+ minutes after it was saved (never analyzed) or
// after its analysis started: its run was cut off. The call page's version of
// isCallAnalysisStuck (db/call-analysis.ts), which the list uses.
function isAnalysisStuck(call: Pick<CallListRow, "analysisStatus" | "createdAt" | "analysisStartedAt">, now: Date): boolean {
  const staleBefore = now.getTime() - STALE_ANALYSIS_MINUTES * 60 * 1000;
  if (call.analysisStatus === "pending") {
    return call.createdAt.getTime() < staleBefore;
  }
  if (call.analysisStatus === "analyzing") {
    return call.analysisStartedAt !== null && call.analysisStartedAt.getTime() < staleBefore;
  }
  return false;
}
