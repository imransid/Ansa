import "server-only";
import { and, eq, lt, or, sql } from "drizzle-orm";
import type { NewTicketInput } from "@/lib/validation/tickets";
import { db } from "./client";
import { calls, type CallOutcome, type DecisionSource } from "./schema";
import { insertTicketWithNextNumber } from "./tickets";

export type CallToAnalyze = {
  vapiCallId: string;
  callerNumber: string | null;
  endedReason: string | null;
  transcriptEncrypted: string | null;
};

export type StoredDecision = {
  outcome: CallOutcome;
  source: DecisionSource;
  reasonCode: string;
  model: string | null;
  issueEncrypted: string | null;
  explanationEncrypted: string | null;
};

// An analysis that started this long ago is treated as dead and may be redone.
export const STALE_ANALYSIS_MINUTES = 5;

// Marks one call of one company as "analyzing" and returns what the analysis
// needs. Returns undefined if the call is not this company's, is already
// decided, or another analysis started less than 5 minutes ago. One UPDATE does
// the check and the claim, so the same call is never sent to Claude twice at once.
export async function claimCallForAnalysis(
  companyId: string,
  callId: string,
): Promise<CallToAnalyze | undefined> {
  const [claimed] = await db
    .update(calls)
    .set({ analysisStatus: "analyzing", analysisStartedAt: sql`now()` })
    .where(
      and(
        eq(calls.id, callId),
        eq(calls.companyId, companyId),
        or(
          eq(calls.analysisStatus, "pending"),
          and(
            eq(calls.analysisStatus, "analyzing"),
            lt(calls.analysisStartedAt, sql`now() - make_interval(mins => ${STALE_ANALYSIS_MINUTES})`),
          ),
        ),
      ),
    )
    .returning({
      vapiCallId: calls.vapiCallId,
      callerNumber: calls.callerNumber,
      endedReason: calls.endedReason,
      transcriptEncrypted: calls.transcriptEncrypted,
    });
  return claimed;
}

// Stores the decision for one call of one company that is being analyzed and,
// when `ticket` is given, creates that call's ticket in the SAME transaction:
// a call is never escalated without its ticket, and never gets two.
// Returns false if the call was no longer "analyzing" (another run finished first).
export async function saveCallDecision(
  companyId: string,
  callId: string,
  decision: StoredDecision,
  ticket: NewTicketInput | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const saved = await tx
      .update(calls)
      .set({
        analysisStatus: "decided",
        aiOutcome: decision.outcome,
        aiDecisionSource: decision.source,
        aiReasonCode: decision.reasonCode,
        aiModel: decision.model,
        aiIssueEncrypted: decision.issueEncrypted,
        aiExplanationEncrypted: decision.explanationEncrypted,
        decidedAt: sql`now()`,
      })
      .where(
        and(
          eq(calls.id, callId),
          eq(calls.companyId, companyId),
          eq(calls.analysisStatus, "analyzing"),
        ),
      )
      .returning({ id: calls.id });

    if (saved.length === 0) {
      return false;
    }
    if (ticket) {
      await insertTicketWithNextNumber(tx, companyId, ticket, callId);
    }
    return true;
  });
}
