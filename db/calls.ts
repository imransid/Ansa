import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { calls, type CallAnalysisStatus, type CallOutcome } from "./schema";

export type CallListItem = {
  id: string;
  callerNumber: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  endedReason: string | null;
  analysisStatus: CallAnalysisStatus;
  aiOutcome: CallOutcome | null;
};

export type StoredCall = typeof calls.$inferSelect;

type NewCall = {
  phoneLineId: string;
  vapiCallId: string;
  callerNumber: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  endedReason: string | null;
  // Already encrypted by the caller (see services/calls.ts).
  transcriptEncrypted: string | null;
};

// No pagination yet, same as tickets.
const CALL_LIST_LIMIT = 50;

// Saves a finished call for one company, unless a call with the same Vapi id
// was already saved. Returns the new call's id, or null if it already existed.
export async function insertCallIfNew(companyId: string, call: NewCall): Promise<string | null> {
  const [inserted] = await db
    .insert(calls)
    .values({ companyId, ...call })
    .onConflictDoNothing({ target: calls.vapiCallId })
    .returning({ id: calls.id });
  return inserted?.id ?? null;
}

// Lists one company's calls, newest first. Leaves out the transcript.
export async function getCallsForCompany(companyId: string): Promise<CallListItem[]> {
  return db
    .select({
      id: calls.id,
      callerNumber: calls.callerNumber,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      endedReason: calls.endedReason,
      analysisStatus: calls.analysisStatus,
      aiOutcome: calls.aiOutcome,
    })
    .from(calls)
    .where(eq(calls.companyId, companyId))
    .orderBy(desc(calls.createdAt))
    .limit(CALL_LIST_LIMIT);
}

// Reads one call of one company, including its encrypted transcript.
export async function getCallById(
  companyId: string,
  callId: string,
): Promise<StoredCall | undefined> {
  const [call] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.companyId, companyId)));
  return call;
}
