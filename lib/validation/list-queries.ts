import { z } from "zod";
import type { UserRole } from "@/db/schema";
import { analyticsPeriods, DEFAULT_ANALYTICS_PERIOD, type AnalyticsPeriod } from "@/lib/analytics/kinds";
import { socialPlatforms } from "@/lib/social-platforms";

// What the ticket and call lists read from their URL (step 29): which view,
// and the search text. Like ?page= (lib/pagination.ts), anything missing or
// odd quietly falls back to the default instead of failing the page.

// The ticket list's views (/dashboard?view=...). "mine" is the logged-in
// person's open tickets: who that is always comes from the session, never
// from the URL (there is no user id in this query at all).
export const ticketViews = ["open", "mine", "unassigned", "solved", "all"] as const;
export type TicketView = (typeof ticketViews)[number];

export type TicketListQuery = {
  view: TicketView;
  // The text to look for, or null for no search.
  search: string | null;
};

// The call list's filters by what the AI decided (/calls?outcome=...).
// "stuck": the analysis never finished (see isCallAnalysisStuck in db/call-analysis.ts).
export const callOutcomeFilters = ["all", "solved", "needs_human", "stuck"] as const;
export type CallOutcomeFilter = (typeof callOutcomeFilters)[number];

export type CallListQuery = {
  outcome: CallOutcomeFilter;
  // Part of a caller's number, or null for no search.
  search: string | null;
};

// The Knowledge page's filters by status (/knowledge?status=..., step 34).
// The same list as lib/knowledge/kinds.ts, plus "all".
export const knowledgeStatusFilters = ["all", "draft", "approved", "archived"] as const;
export type KnowledgeStatusFilter = (typeof knowledgeStatusFilters)[number];

export type KnowledgeListQuery = {
  status: KnowledgeStatusFilter;
  // Text to find in the titles, or null for no search.
  search: string | null;
};

// The content studio's filters (/cofounder/studio?status=...&platform=...,
// step 38). "current": every draft but the archived ones, where the list
// starts; every status (the publishing queue's too, step 41); and every platform.
export const contentDraftStatusFilters = ["current", "idea", "draft", "approved", "rejected", "scheduled", "published", "failed", "archived"] as const;
export type ContentDraftStatusFilter = (typeof contentDraftStatusFilters)[number];
export const contentDraftPlatformFilters = ["all", ...socialPlatforms] as const;
export type ContentDraftPlatformFilter = (typeof contentDraftPlatformFilters)[number];

export type ContentDraftListQuery = {
  status: ContentDraftStatusFilter;
  platform: ContentDraftPlatformFilter;
};

// The values every link and the search box send, as URL parameters.
type RawListQuery = { view?: unknown; outcome?: unknown; status?: unknown; platform?: unknown; period?: unknown; q?: unknown };

const ticketViewSchema = z.enum(ticketViews);
const callOutcomeSchema = z.enum(callOutcomeFilters);
const knowledgeStatusSchema = z.enum(knowledgeStatusFilters);
const contentDraftStatusSchema = z.enum(contentDraftStatusFilters);
const contentDraftPlatformSchema = z.enum(contentDraftPlatformFilters);
const analyticsPeriodSchema = z.enum(analyticsPeriods);

// Trimmed, 1 to 100 characters, no control characters: Postgres refuses a
// NUL byte in text, so "?q=%00" would otherwise make the page fail.
const searchTextSchema = z.string().trim().min(1).max(100).regex(/^[^\p{Cc}]+$/u);

// Members land on their own open tickets. Owners land on every open ticket,
// because they are the ones who notice tickets nobody has.
export function defaultTicketViewFor(role: UserRole): TicketView {
  return role === "owner" ? "open" : "mine";
}

// Reads ?view= and ?q= for the ticket list. An unknown or repeated view
// (?view=a&view=b) becomes defaultView; see parseSearchText for ?q=.
export function parseTicketListQuery(query: RawListQuery, defaultView: TicketView): TicketListQuery {
  const view = ticketViewSchema.safeParse(query.view);
  return { view: view.success ? view.data : defaultView, search: parseSearchText(query.q) };
}

// Reads ?outcome= and ?q= for the call list. An unknown or repeated outcome means all calls.
export function parseCallListQuery(query: RawListQuery): CallListQuery {
  const outcome = callOutcomeSchema.safeParse(query.outcome);
  return { outcome: outcome.success ? outcome.data : "all", search: parseSearchText(query.q) };
}

// Reads ?status= and ?q= for the Knowledge page. An unknown or repeated
// status means every article.
export function parseKnowledgeListQuery(query: RawListQuery): KnowledgeListQuery {
  const status = knowledgeStatusSchema.safeParse(query.status);
  return { status: status.success ? status.data : "all", search: parseSearchText(query.q) };
}

// Reads ?status= and ?platform= for the content studio. An unknown or
// repeated value falls back to the current drafts of every platform.
export function parseContentDraftListQuery(query: RawListQuery): ContentDraftListQuery {
  const status = contentDraftStatusSchema.safeParse(query.status);
  const platform = contentDraftPlatformSchema.safeParse(query.platform);
  return { status: status.success ? status.data : "current", platform: platform.success ? platform.data : "all" };
}

// Reads ?period= for the Co-Founder's Analytics page (step 42): 7, 30 or 90
// days. An unknown or repeated period means the last 30 days.
export function parseAnalyticsPeriod(query: RawListQuery): AnalyticsPeriod {
  const period = analyticsPeriodSchema.safeParse(query.period);
  return period.success ? period.data : DEFAULT_ANALYTICS_PERIOD;
}

// Reads ?q=. Missing, blank, repeated (?q=a&q=b), longer than 100 characters
// or holding control characters means no search.
function parseSearchText(value: unknown): string | null {
  const parsed = searchTextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
