import "server-only";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "./client";
import { calls, type CallOutcome, type DecisionSource } from "./schema";
import { insertTicketWithNextNumber, type TicketToCreate } from "./ticket-creation";

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
  // The SDK error's class name when asking Claude failed (a name only).
  errorClass: string | null;
  issueEncrypted: string | null;
  explanationEncrypted: string | null;
  // "solved" only: the customer's confirming sentence, encrypted (step 31).
  evidenceEncrypted: string | null;
};

// An analysis that started this long ago is treated as dead and may be redone.
export const STALE_ANALYSIS_MINUTES = 5;

// A call still not decided 5+ minutes after it was saved (never analyzed) or
// after its analysis started: its run was cut off. The Calls list marks it
// "Stuck: analyze now" and its "Stuck" filter lists it (step 29), both from
// this one condition, with the database's clock.
export function isCallAnalysisStuck() {
  const staleSince = sql`now() - make_interval(mins => ${STALE_ANALYSIS_MINUTES})`;
  return or(
    and(eq(calls.analysisStatus, "pending"), lt(calls.createdAt, staleSince)),
    and(eq(calls.analysisStatus, "analyzing"), lt(calls.analysisStartedAt, staleSince)),
  );
}

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

// What saveCallDecision did. saved is false if the call was no longer
// "analyzing" (another run finished first). ticketId / assignedToUserId
// describe the ticket created, if any.
export type SavedDecision = {
  saved: boolean;
  ticketId: string | null;
  assignedToUserId: string | null;
};

// Stores the decision for one call of one company that is being analyzed and,
// when `ticket` is given, creates that call's ticket in the SAME transaction:
// a call is never escalated without its ticket, and never gets two.
export async function saveCallDecision(
  companyId: string,
  callId: string,
  decision: StoredDecision,
  ticket: TicketToCreate | null,
): Promise<SavedDecision> {
  return db.transaction(async (tx) => {
    const saved = await tx
      .update(calls)
      .set({
        analysisStatus: "decided",
        aiOutcome: decision.outcome,
        aiDecisionSource: decision.source,
        aiReasonCode: decision.reasonCode,
        aiModel: decision.model,
        aiErrorClass: decision.errorClass,
        aiIssueEncrypted: decision.issueEncrypted,
        aiExplanationEncrypted: decision.explanationEncrypted,
        aiEvidenceEncrypted: decision.evidenceEncrypted,
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
      return { saved: false, ticketId: null, assignedToUserId: null };
    }
    if (!ticket) {
      return { saved: true, ticketId: null, assignedToUserId: null };
    }
    const created = await insertTicketWithNextNumber(tx, companyId, ticket, callId);
    return { saved: true, ticketId: created.id, assignedToUserId: created.assignedToUserId };
  });
}
