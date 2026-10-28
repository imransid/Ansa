"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { CONTENT_FORMAT_LABELS, CONTENT_STATUS_LABELS, type ContentDraftStatus } from "@/lib/content-studio/formats";
import { PUBLISH_JOB_STATUS_LABELS, type PublishJobStatus } from "@/lib/publishing/kinds";
import { CALENDAR_DAYS } from "@/lib/publishing/limits";
import { addDays, isKnownTimeZone, localDateOf, localTimeOf, weekdayOf } from "@/lib/publishing/schedule-time";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "@/services/publishing-pages";

// The calendar's days (step 41): today and the next weeks in the VIEWER's
// own timezone, each with its posts (scheduled, out, or that didn't go out)
// and its planned drafts and ideas, by time. The server doesn't know the
// viewer's timezone, so the days are worked out in the browser; until then
// (and on the server) a line says so. A colour stripe goes with each status,
// and the status is always written too.
export function CalendarDays({ items }: { items: CalendarItem[] }) {
  const inBrowser = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  if (!inBrowser) {
    return <p className="text-sm text-muted-foreground">Putting the calendar in your timezone...</p>;
  }
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = browserZone && isKnownTimeZone(browserZone) ? browserZone : "UTC";
  const today = localDateOf(new Date(), timeZone);
  const days = Array.from({ length: CALENDAR_DAYS }, (_unused, index) => addDays(today, index));
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const day = localDateOf(new Date(item.at), timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  return (
    <ol className="grid gap-3">
      {days.map((day) => (
        <CalendarDay key={day} day={day} isToday={day === today} items={byDay.get(day) ?? []} timeZone={timeZone} />
      ))}
    </ol>
  );
}

function CalendarDay({ day, isToday, items, timeZone }: { day: string; isToday: boolean; items: CalendarItem[]; timeZone: string }) {
  return (
    <li className="grid gap-2 border-b pb-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <p className="text-sm font-medium">
        {isToday ? "Today, " : ""}
        {weekdayOf(day)} <span className="text-muted-foreground tabular-nums">{day}</span>
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing planned.</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((item) => (
            <CalendarEntry key={`${item.kind}-${item.id}`} item={item} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </li>
  );
}

function CalendarEntry({ item, timeZone }: { item: CalendarItem; timeZone: string }) {
  return (
    <li className={cn("grid gap-1 rounded-md border border-l-4 p-2 text-sm", stripeOf(item))}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">{localTimeOf(new Date(item.at), timeZone)}</span>
        <Badge variant="outline">{SOCIAL_PLATFORM_LABELS[item.platform]}</Badge>
        <span className="text-muted-foreground">{statusOf(item)}</span>
      </div>
      <Link href={`/cofounder/studio/${item.draftId}`} className="font-medium underline wrap-anywhere">
        {item.topic}
      </Link>
      <span className="text-muted-foreground wrap-anywhere">
        {CONTENT_FORMAT_LABELS[item.format]}
        {item.accountName ? `, to ${item.accountName}` : ""}
      </span>
    </li>
  );
}

// A post's status, or a draft's with "Planned" before it.
function statusOf(item: CalendarItem): string {
  if (item.kind === "job") {
    return PUBLISH_JOB_STATUS_LABELS[item.status as PublishJobStatus];
  }
  return `Planned (${CONTENT_STATUS_LABELS[item.status as ContentDraftStatus]})`;
}

// The stripe's colour: blue on its way, green out, red for a problem; a
// planned draft amber, an idea a dashed grey.
function stripeOf(item: CalendarItem): string {
  if (item.kind === "draft") {
    return item.status === "idea" ? "border-dashed border-l-muted-foreground/40" : "border-l-amber-500";
  }
  switch (item.status) {
    case "published":
      return "border-l-emerald-600";
    case "failed":
    case "needs_attention":
      return "border-l-destructive";
    default:
      return "border-l-sky-600";
  }
}

// Nothing changes after the page has loaded, so there is nothing to subscribe to.
function subscribeToNothing(): () => void {
  return () => {};
}
