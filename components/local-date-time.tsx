"use client";

import { useSyncExternalStore } from "react";

type LocalDateTimeProps = {
  iso: string;
  // Lists: only the date ("17 Oct 2026"), so the column stays narrow. The
  // full time with its zone shows when the pointer rests on it.
  dateOnly?: boolean;
};

// Shows a moment in the VIEWER's own timezone, with the zone's name
// ("17 Oct 2026, 15:05 CEST"). Times are stored in UTC.
//
// The server doesn't know the viewer's timezone, so the first render (on the
// server, and in the browser while the page wakes up) shows UTC. Right after,
// the browser switches to local time. useSyncExternalStore is React's way to
// render differently on the server and in the browser without a mismatch error.
export function LocalDateTime({ iso, dateOnly = false }: LocalDateTimeProps) {
  const inBrowser = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const date = new Date(iso);
  const fullText = inBrowser ? localFormat.format(date) : `${utcFormat.format(date)} UTC`;
  if (!dateOnly) {
    return <time dateTime={iso}>{fullText}</time>;
  }
  return (
    <time dateTime={iso} title={fullText}>
      {inBrowser ? localDateFormat.format(date) : utcDateFormat.format(date)}
    </time>
  );
}

// undefined locale and timezone = the viewer's own browser settings.
// Spelled out part by part: browsers refuse dateStyle/timeStyle together with
// timeZoneName ("Invalid option"), and we want the zone's name shown.
const localFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

const localDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const utcFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const utcDateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

// Nothing ever changes after the page has loaded, so there is nothing to subscribe to.
function subscribeToNothing(): () => void {
  return () => {};
}
