import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { PAGE_SIZE, pageOffset } from "@/lib/pagination";
import type { CallListQuery, CallOutcomeFilter } from "@/lib/validation/list-queries";
import { isCallAnalysisStuck } from "./call-analysis";
import { callOutcomeCondition, callSearchCondition } from "./call-filters";
import { db } from "./client";
import { calls, users, type CallAnalysisStatus, type CallOutcome } from "./schema";

export type CallListRow = {
  id: string;
  callerNumber: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  endedReason: string | null;
  analysisStatus: CallAnalysisStatus;
  aiOutcome: CallOutcome | null;
  createdAt: Date;
  analysisStartedAt: Date | null;
  // Never analyzed, or its analysis started, 5+ minutes ago and still not
  // decided: the run was cut off. The list says "Stuck: analyze now" (step 27).
  analysisStuck: boolean;
  // When a teammate escalated this "solved" call to a ticket (step 31), or null.
  escalatedAt: Date | null;
};

// How many calls each filter of the list holds (step 29).
export type CallOutcomeCounts = Record<CallOutcomeFilter, number>;

export type StoredCall = typeof calls.$inferSelect;

// One call with the name of whoever escalated it, if anyone (step 31).
export type CallWithEscalator = StoredCall & { escalatedByName: string | null };

// The person who escalated a call. The join also matches company_id, so a
// name from another company can never show up.
const escalator = alias(users, "escalator");

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
    // Every column named, never a spread of `call`: an object with extra
    // fields (a companyId, an analysis outcome) can't write them.
    .values({
      companyId,
      phoneLineId: call.phoneLineId,
      vapiCallId: call.vapiCallId,
      callerNumber: call.callerNumber,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      endedReason: call.endedReason,
      transcriptEncrypted: call.transcriptEncrypted,
    })
    .onConflictDoNothing({ target: calls.vapiCallId })
    .returning({ id: calls.id });
  return inserted?.id ?? null;
}

// Lists one page of one company's calls with one filter and an optional
// search, newest first. Leaves out the transcript.
export async function getCallsForCompany(companyId: string, query: CallListQuery, page: number): Promise<CallListRow[]> {
  return db
    .select({
      id: calls.id,
      callerNumber: calls.callerNumber,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      endedReason: calls.endedReason,
      analysisStatus: calls.analysisStatus,
      aiOutcome: calls.aiOutcome,
      createdAt: calls.createdAt,
      analysisStartedAt: calls.analysisStartedAt,
      analysisStuck: sql<boolean>`coalesce(${isCallAnalysisStuck()}, false)`,
      escalatedAt: calls.escalatedAt,
    })
    .from(calls)
    .where(callListWhere(companyId, query))
    // id breaks ties, so a call never shows up on two pages.
    .orderBy(desc(calls.createdAt), desc(calls.id))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
}

// Counts one company's calls under every filter at once, with the list's
// search: the numbers on the filter links ("Stuck (2)") and "Page 2 of 5".
// Each count uses its filter's own condition (db/call-filters.ts), so a
// link's number always matches the list it opens.
export async function countCallsPerOutcome(companyId: string, search: string | null): Promise<CallOutcomeCounts> {
  const [counts] = await db
    .select({
      all: countWhere(callOutcomeCondition("all")),
      solved: countWhere(callOutcomeCondition("solved")),
      needs_human: countWhere(callOutcomeCondition("needs_human")),
      stuck: countWhere(callOutcomeCondition("stuck")),
    })
    .from(calls)
    // Every call of the company that the search finds; each count above then
    // keeps its own filter's.
    .where(callListWhere(companyId, { outcome: "all", search }));
  return counts ?? { all: 0, solved: 0, needs_human: 0, stuck: 0 };
}

// Reads one call of one company, including its encrypted transcript, and the
// name of whoever escalated it.
export async function getCallById(
  companyId: string,
  callId: string,
): Promise<CallWithEscalator | undefined> {
  const [row] = await db
    .select({ call: calls, escalatedByName: escalator.name })
    .from(calls)
    .leftJoin(escalator, and(eq(escalator.id, calls.escalatedByUserId), eq(escalator.companyId, calls.companyId)))
    .where(and(eq(calls.id, callId), eq(calls.companyId, companyId)));
  if (!row) {
    return undefined;
  }
  return { ...row.call, escalatedByName: row.escalatedByName };
}

// The WHERE of the call list: ALWAYS the company first, then the filter and
// the search.
function callListWhere(companyId: string, query: CallListQuery) {
  return and(eq(calls.companyId, companyId), callOutcomeCondition(query.outcome), callSearchCondition(query.search));
}

// Counts only the rows that match, in the same pass over the table as the
// other counts. No condition ("all") counts every row.
function countWhere(condition: SQL | undefined) {
  return sql<number>`count(*) filter (where ${condition ?? sql`true`})`.mapWith(Number);
}
