import "server-only";
import { callCore } from "@/lib/core-api";
import { coreFormErrors } from "@/lib/core-views/restaurant-setup";
import type { FormErrors } from "@/lib/form-result";
import type { getAwaySummaryForSession, Presence } from "@/services/away";
import type { BusinessOverview } from "@/services/business-overview";
import type { getAssistantActivityForSession, InboxRow } from "@/services/conversations";
import type { FirstRunHints } from "@/services/dashboard";
import type { GettingStartedStep, getNeedsYouForSession } from "@/services/home";

// Home through the new backend (core's GET /api/v1/home), in the shapes
// Home's parts already read, and the owner's switches (core's
// /api/v1/assistant/* and /api/v1/home/away-summary/seen).

type AwaySummary = Awaited<ReturnType<typeof getAwaySummaryForSession>>;
type ActivityRow = Awaited<ReturnType<typeof getAssistantActivityForSession>>[number];
type NeedsYou = Awaited<ReturnType<typeof getNeedsYouForSession>>;

// Everything Home shows: what ansa does now, the business's numbers, the
// customer emails never delivered, the first-run hint, what's left to set
// up, what ansa did while you were away, who needs you, new orders and
// ansa's newest work.
export type HomeData = {
  presence: Presence;
  overview: BusinessOverview;
  undeliveredEmails: number;
  hints: FirstRunHints;
  gettingStarted: GettingStartedStep[];
  awaySummary: AwaySummary;
  needsYou: NeedsYou;
  newOrders: number;
  activity: ActivityRow[];
};

type CorePresence = Omit<Presence, "availability"> & {
  answerWhen: Presence["availability"]["answerWhen"];
  awaySince: string | null;
  replyGraceMinutes: number | null;
};

type CoreAwayLine = Omit<AwaySummary["conversations"][number], "createdAt"> & { createdAt: string };
type CoreInboxRow = Omit<InboxRow, "lastActivityAt" | "openTicket"> & {
  lastActivityAt: string;
  openTicket: { id: string; number: number; subject: string } | null;
};
type CoreActivityRow = Omit<ActivityRow, "createdAt"> & { createdAt: string };

type CoreHome = {
  presence: CorePresence;
  overview: BusinessOverview;
  undeliveredEmails: number;
  handlesNoCategory: boolean;
  gettingStarted: GettingStartedStep[];
  // Only while ansa answers when you're away.
  awaySummary?: Omit<AwaySummary, "since" | "conversations"> & { since: string; conversations: CoreAwayLine[] };
  needsYou: { rows: CoreInboxRow[]; total: number; hasTeam: boolean };
  newOrders: number;
  activity: CoreActivityRow[];
};

export async function getHomeFromCore(): Promise<HomeData> {
  const answer = await callCore<CoreHome>("GET", "/api/v1/home");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const home = answer.data;
  return {
    presence: toPresence(home.presence),
    overview: home.overview,
    undeliveredEmails: home.undeliveredEmails,
    // The Setup steps' count is no longer shown on Home (FirstRunNotices
    // reads handlesNoCategory only), so core doesn't send it.
    hints: { setupStepsLeft: null, handlesNoCategory: home.handlesNoCategory },
    gettingStarted: home.gettingStarted,
    awaySummary: toAwaySummary(home.awaySummary),
    needsYou: { rows: home.needsYou.rows.map(toInboxRow), total: home.needsYou.total, hasTeam: home.needsYou.hasTeam },
    newOrders: home.newOrders,
    activity: home.activity.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })),
  };
}

// What ansa does now. Core leaves out the away hours and their time zone:
// Home doesn't show them (awayNow already says whether it is one of them).
function toPresence(presence: CorePresence): Presence {
  return {
    kind: presence.kind,
    status: presence.status,
    availability: {
      answerWhen: presence.answerWhen,
      awaySince: presence.awaySince ? new Date(presence.awaySince) : null,
      awayHours: null,
      timeZone: null,
      replyGraceMinutes: presence.replyGraceMinutes,
    },
    awayNow: presence.awayNow,
    coverText: presence.coverText,
    canManage: presence.canManage,
  };
}

// Without one (ansa answers always), an empty summary: the card shows nothing.
function toAwaySummary(summary: CoreHome["awaySummary"]): AwaySummary {
  if (!summary) {
    return { since: new Date(), replies: 0, notes: 0, waiting: 0, conversations: [] };
  }
  return {
    since: new Date(summary.since),
    replies: summary.replies,
    notes: summary.notes,
    waiting: summary.waiting,
    conversations: summary.conversations.map((line) => ({ ...line, createdAt: new Date(line.createdAt) })),
  };
}

function toInboxRow(row: CoreInboxRow): InboxRow {
  return {
    id: row.id,
    channel: row.channel,
    displayName: row.displayName,
    externalId: row.externalId,
    handledBy: row.handledBy,
    lastActivityAt: new Date(row.lastActivityAt),
    preview: row.preview,
    openTicket: row.openTicket ? { ticketNumber: row.openTicket.number, subject: row.openTicket.subject } : null,
  };
}

type Switched = { ok: true } | { ok: false; errors: FormErrors };

// "I'm away" (true) or "I'm back". Anything else is sent as null, which core refuses.
export async function setAwayThroughCore(away: unknown): Promise<Switched> {
  return answered(await callCore("POST", "/api/v1/assistant/away", { away: away === "on" ? true : away === "off" ? false : null }));
}

// "Pause ansa" ("paused") or "Turn ansa on" ("on").
export async function setAssistantStatusThroughCore(status: unknown): Promise<Switched> {
  return answered(await callCore("POST", "/api/v1/assistant/status", { status: typeof status === "string" ? status : "" }));
}

// "Always" or "Only when I'm away".
export async function saveAnswerWhenThroughCore(answerWhen: unknown): Promise<Switched> {
  return answered(await callCore("POST", "/api/v1/assistant/answer-when", { answerWhen: typeof answerWhen === "string" ? answerWhen : "" }));
}

// "Got it" on "While you were away".
export async function markAwaySummarySeenThroughCore(): Promise<Switched> {
  return answered(await callCore("POST", "/api/v1/home/away-summary/seen"));
}

// A conversation page's "Important" switch (its action lives with the
// away switches, app/actions/away.ts). Anything but on/off is sent as null,
// which core refuses.
export async function setImportantThroughCore(conversationId: unknown, important: unknown): Promise<Switched> {
  // An empty id would put "//" in the path; "missing" is no conversation's
  // id, so core answers that it isn't there.
  const id = typeof conversationId === "string" && conversationId !== "" ? conversationId : "missing";
  const body = { important: important === "on" ? true : important === "off" ? false : null };
  return answered(await callCore("POST", `/api/v1/conversations/${encodeURIComponent(id)}/important`, body));
}

function answered(answer: Awaited<ReturnType<typeof callCore>>): Switched {
  return answer.ok ? { ok: true } : { ok: false, errors: coreFormErrors(answer) };
}
