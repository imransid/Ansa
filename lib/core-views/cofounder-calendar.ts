import "server-only";
import { callCore } from "@/lib/core-api";
import type { CalendarItem, CalendarPage } from "@/lib/types/publishing-pages";

// The Co-Founder's calendar page through the new backend (core's GET
// /api/v1/cofounder/calendar), in the shape the page already reads: the
// company's posts (not canceled) and the drafts planned for a day, from a
// day ago to a day past the four weeks, in time order; the current plan's
// version (null: none core can read) and whether this person plans with the
// AI (owners). "Plan the next 2 weeks" is app/actions/publishing.ts.

export async function getCalendarPageFromCore(): Promise<CalendarPage> {
  const answer = await callCore<CalendarPage>("GET", "/api/v1/cofounder/calendar");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { items: (answer.data.items ?? []).map(toCalendarItem), planVersion: answer.data.planVersion, canPlan: answer.data.canPlan };
}

// Every field named: the items go to the browser, which puts each on the
// viewer's own day. The time as ISO text with milliseconds and "Z", as the
// old page sent it (core's may carry microseconds or an offset).
function toCalendarItem(item: CalendarItem): CalendarItem {
  return {
    kind: item.kind,
    id: item.id,
    at: new Date(item.at).toISOString(),
    draftId: item.draftId,
    topic: item.topic,
    platform: item.platform,
    format: item.format,
    status: item.status,
    accountName: item.accountName,
  };
}
