import "server-only";
import { and, eq, ilike, like, or, type SQL } from "drizzle-orm";
import { containsPattern, phoneDigitsInSearch } from "@/lib/search-patterns";
import type { CallOutcomeFilter } from "@/lib/validation/list-queries";
import { isCallAnalysisStuck } from "./call-analysis";
import { phoneDigitsOf } from "./phone-digits";
import { calls } from "./schema";

// The conditions behind the Calls list's filters and search (step 29). Never
// use them on their own: db/calls.ts puts eq(calls.companyId, companyId)
// first in every query that uses them.

// The calls one filter shows, by what the AI decided. "all" adds no condition.
export function callOutcomeCondition(outcome: CallOutcomeFilter): SQL | undefined {
  switch (outcome) {
    case "solved":
      return and(eq(calls.analysisStatus, "decided"), eq(calls.aiOutcome, "solved"));
    case "needs_human":
      return and(eq(calls.analysisStatus, "decided"), eq(calls.aiOutcome, "needs_human"));
    case "stuck":
      return isCallAnalysisStuck();
    case "all":
      return undefined;
  }
}

// The calls a search finds: the text anywhere in the caller's number, or the
// same digits however the number is written ("555-0177" finds "+15550177").
// Caller numbers are stored unencrypted (decisions log), so Postgres can
// search them. Every value goes to Postgres as a parameter.
export function callSearchCondition(search: string | null): SQL | undefined {
  if (!search) {
    return undefined;
  }
  const conditions: SQL[] = [ilike(calls.callerNumber, containsPattern(search))];
  const digits = phoneDigitsInSearch(search);
  if (digits) {
    conditions.push(like(phoneDigitsOf(calls.callerNumber), `%${digits}%`));
  }
  return or(...conditions);
}
