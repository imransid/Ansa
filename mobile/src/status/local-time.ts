// Times as the phone's owner reads them: in the phone's own time zone and
// clock style (12 or 24 hours), from the RFC 3339 times core sends.

const DAY_MS = 24 * 60 * 60 * 1000;

// "21:40" today, "Yesterday, 21:40", "Mon 3 Nov, 21:40" before that.
// Empty for a time that can't be read.
export function describeLocalTime(iso: string, now: Date = new Date()): string {
  const parts = readParts(iso, now);
  if (parts === null) return "";
  if (parts.days === 0) return parts.clock;
  if (parts.days === 1) return `Yesterday, ${parts.clock}`;
  return `${parts.day}, ${parts.clock}`;
}

// "Since 21:40", "Since yesterday at 21:40", "Since Mon 3 Nov at 21:40".
// Empty without a time.
export function describeSince(iso: string, now: Date = new Date()): string {
  const parts = readParts(iso, now);
  if (parts === null) return "";
  if (parts.days === 0) return `Since ${parts.clock}`;
  if (parts.days === 1) return `Since yesterday at ${parts.clock}`;
  return `Since ${parts.day} at ${parts.clock}`;
}

// The clock time, the day, and how many calendar days ago, in the phone's
// time zone and clock style.
function readParts(iso: string, now: Date): { clock: string; day: string; days: number } | null {
  const time = new Date(iso);
  if (iso === "" || Number.isNaN(time.getTime())) return null;
  return {
    clock: time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    day: time.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
    days: daysBetween(time, now),
  };
}

// "just now", "2 minutes ago", "an hour ago", "at 21:40": for the quiet
// "Checked in ..." line.
export function describeAgo(time: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - time.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  if (minutes < 90) return "an hour ago";
  return `at ${describeLocalTime(time.toISOString(), now)}`;
}

// Calendar days between two times in the phone's time zone (0 = same day).
function daysBetween(earlier: Date, later: Date): number {
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOf(later) - startOf(earlier)) / DAY_MS);
}
