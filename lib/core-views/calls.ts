import "server-only";
import { cache } from "react";
import { callCore } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormResult } from "@/lib/form-result";
import type { CallDetail, CallListItem, CallOutcomeCounts } from "@/lib/types/calls";
import type { CategoryChoice } from "@/lib/types/categories";
import type { CallKnowledgeLookups } from "@/lib/types/knowledge-lookups";
import type { CreatedTicketResult } from "@/lib/types/manual-tickets";
import type { CallListQuery } from "@/lib/validation/list-queries";
import { callIdSchema } from "@/lib/validation/vapi";

// The Calls list, a call's page and its actions through the new backend
// (core's /api/v1/calls), in the shapes the pages already read.

// One call as core's JSON has it (dates as text).
type CoreCallRow = {
  id: string;
  callerNumber: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  analysisStatus: CallListItem["analysisStatus"];
  aiOutcome: CallListItem["aiOutcome"];
  createdAt: string;
  analysisStartedAt: string | null;
  analysisStuck: boolean;
  escalatedAt: string | null;
};

// Core also sends analysis.reason (the reason already worded); the page
// words it itself (lib/call-brain/reasons.ts), as before.
type CoreCallDetail = CoreCallRow & {
  transcript: string | null;
  transcriptUnreadable: boolean;
  recordingStatus: CallDetail["recordingStatus"];
  ticketNumber: number | null;
  escalation: { byName: string | null; at: string } | null;
  analysis: Omit<CallDetail["analysis"], "decidedAt"> & { decidedAt: string | null };
};

type CoreLookup = { id: string; at: string; articles: { articleId: string; title: string | null }[] };

type CoreCallPage = {
  call: CoreCallDetail;
  lookups: CoreLookup[];
  moreLookupsNotShown: boolean;
  categories: CategoryChoice[];
};

// What a call's page reads: the call, the knowledge the assistant looked
// up during it, and the categories for "Escalate to a ticket".
type CallPage = {
  call: CallDetail;
  lookups: CallKnowledgeLookups;
  categories: CategoryChoice[];
};

function dateOrNull(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

function toCallListItem(row: CoreCallRow): CallListItem {
  return {
    id: row.id,
    callerNumber: row.callerNumber,
    startedAt: dateOrNull(row.startedAt),
    endedAt: dateOrNull(row.endedAt),
    endedReason: row.endedReason,
    analysisStatus: row.analysisStatus,
    aiOutcome: row.aiOutcome,
    createdAt: new Date(row.createdAt),
    analysisStartedAt: dateOrNull(row.analysisStartedAt),
    analysisStuck: row.analysisStuck,
    escalatedAt: dateOrNull(row.escalatedAt),
  };
}

function toCallDetail(call: CoreCallDetail): CallDetail {
  const { analysis } = call;
  return {
    ...toCallListItem(call),
    transcript: call.transcript,
    transcriptUnreadable: call.transcriptUnreadable,
    recordingStatus: call.recordingStatus,
    ticketNumber: call.ticketNumber,
    escalation: call.escalation ? { byName: call.escalation.byName, at: new Date(call.escalation.at) } : null,
    analysis: {
      source: analysis.source,
      reasonCode: analysis.reasonCode,
      model: analysis.model,
      decidedAt: dateOrNull(analysis.decidedAt),
      issue: analysis.issue,
      explanation: analysis.explanation,
      errorClass: analysis.errorClass,
      evidence: analysis.evidence,
      canAnalyzeNow: analysis.canAnalyzeNow,
      canEscalate: analysis.canEscalate,
    },
  };
}

// The call's path in core. The id is only a claim (from the address or a
// form): anything but a call id is never sent, so it can't turn into
// another path ("..").
export function callPath(callId: unknown, action = ""): string | null {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) {
    return null;
  }
  return `/api/v1/calls/${encodeURIComponent(parsed.data)}${action}`;
}

// One page of the Calls list and the counts under every filter (same
// search), as the page's two reads answered them.
export async function getCallsAndCountsFromCore(page: number, query: CallListQuery): Promise<[CallListItem[], CallOutcomeCounts]> {
  const search = new URLSearchParams({ outcome: query.outcome, q: query.search ?? "", page: String(page) });
  const answer = await callCore<{ calls: CoreCallRow[]; counts: CallOutcomeCounts }>("GET", `/api/v1/calls?${search}`);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return [answer.data.calls.map(toCallListItem), answer.data.counts];
}

// One read per request: the tab title, the page and its lookups all use it.
// Null for a bad id, an unknown call or another company's (the page's not-found).
const getCallPageFromCore = cache(async (callId: string): Promise<CallPage | null> => {
  const path = callPath(callId);
  if (!path) {
    return null;
  }
  const answer = await callCore<CoreCallPage>("GET", path);
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { call, lookups, moreLookupsNotShown, categories } = answer.data;
  return {
    call: toCallDetail(call),
    lookups: { lookups: lookups.map((lookup) => ({ ...lookup, at: new Date(lookup.at) })), moreNotShown: moreLookupsNotShown },
    categories,
  };
});

export async function getCallFromCore(callId: string): Promise<CallDetail | null> {
  return (await getCallPageFromCore(callId))?.call ?? null;
}

// The company's active categories (for "Escalate to a ticket").
export async function getCallCategoriesFromCore(callId: string): Promise<CategoryChoice[]> {
  return (await getCallPageFromCore(callId))?.categories ?? [];
}

// "Knowledge the AI looked up during the call".
export async function getCallLookupsFromCore(callId: string): Promise<CallKnowledgeLookups> {
  return (await getCallPageFromCore(callId))?.lookups ?? { lookups: [], moreNotShown: false };
}

// "Analyze now": the AI reads the call again (core waits for its answer).
export async function analyzeCallThroughCore(input: { callId: unknown }): Promise<FormResult> {
  const path = callPath(input.callId, "/analyze");
  if (!path) {
    return { ok: false, errors: { message: "Unknown call." } };
  }
  const answer = await callCore("POST", path);
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// "Escalate to a ticket" on a call the AI marked solved: the new request's number.
export async function escalateCallThroughCore(input: { callId: unknown; categoryId: unknown; note: unknown }): Promise<CreatedTicketResult> {
  const path = callPath(input.callId, "/escalate");
  if (!path) {
    return { ok: false, errors: { message: "That call was not found in your company." } };
  }
  const answer = await callCore<{ ticketNumber: number }>("POST", path, {
    categoryId: typeof input.categoryId === "string" ? input.categoryId : "",
    note: typeof input.note === "string" ? input.note : "",
  });
  return answer.ok ? { ok: true, ticketNumber: answer.data.ticketNumber } : { ok: false, errors: toFormErrors(answer) };
}
