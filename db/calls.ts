import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { PAGE_SIZE, pageOffset } from "@/lib/pagination";
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

// Lists one page of one company's calls, newest first. Leaves out the transcript.
export async function getCallsForCompany(companyId: string, page: number): Promise<CallListItem[]> {
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
    // id breaks ties, so a call never shows up on two pages.
    .orderBy(desc(calls.createdAt), desc(calls.id))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
}

// Counts one company's calls, for "Page 2 of 5".
export async function countCallsForCompany(companyId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(calls).where(eq(calls.companyId, companyId));
  return row?.total ?? 0;
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
