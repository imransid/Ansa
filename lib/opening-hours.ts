// Opening hours (step 45): a week of times, at most two per day (lunch and
// dinner), each within one day from 00:00 to 24:00. Pure: the forms and
// their actions share these rules; core reads the same shape with its own
// (core/internal/hours, also behind the sidebar's hours): they must agree.

export const WEEKDAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

export type Weekday = (typeof WEEKDAYS)[number]["key"];

// "HH:MM"; a closing time may be "24:00" (midnight at the end of the day).
export type TimeRange = { opens: string; closes: string };
export type OpeningHours = Record<Weekday, TimeRange[]>;

export const RANGES_PER_DAY = 2;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Minutes since the start of the day: "18:30" is 1110, "24:00" is 1440.
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// The form's field for one time: "hours-mon-1-opens".
export function hoursFieldName(day: Weekday, range: number, end: "opens" | "closes"): string {
  return `hours-${day}-${range}-${end}`;
}

// Reads one day's times as typed (each "HH:MM" or empty) and says what is
// wrong with them, if anything. A closing time of 00:00 means midnight.
// Hours past midnight belong to the next day (a known gap: 18:00 to 02:00 is
// entered as 18:00 to 00:00, and 00:00 to 02:00 the day after).
export function readDay(typed: { opens: string; closes: string }[]): { ranges: TimeRange[] } | { error: string } {
  const ranges: TimeRange[] = [];
  for (const { opens, closes } of typed) {
    if (opens === "" && closes === "") {
      continue;
    }
    if (opens === "" || closes === "") {
      return { error: "Give both an opening and a closing time." };
    }
    if (!TIME.test(opens) || !TIME.test(closes)) {
      return { error: "Write times as hours and minutes, like 18:30." };
    }
    const closesAt = closes === "00:00" ? "24:00" : closes;
    if (minutesOf(closesAt) <= minutesOf(opens)) {
      return { error: "Closing time must come after opening time (after midnight goes on the next day)." };
    }
    ranges.push({ opens, closes: closesAt });
  }
  ranges.sort((first, second) => minutesOf(first.opens) - minutesOf(second.opens));
  for (let index = 1; index < ranges.length; index++) {
    if (minutesOf(ranges[index].opens) < minutesOf(ranges[index - 1].closes)) {
      return { error: "These times overlap." };
    }
  }
  return { ranges };
}

// Whether stored hours have the shape this code writes (read back from jsonb).
export function isOpeningHours(value: unknown): value is OpeningHours {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return WEEKDAYS.every(({ key }) => {
    const day = (value as Record<string, unknown>)[key];
    return (
      Array.isArray(day) &&
      day.length <= RANGES_PER_DAY &&
      day.every((range) => typeof range?.opens === "string" && typeof range?.closes === "string")
    );
  });
}

// "18:30", or "midnight" for the end of the day.
export function formatTime(time: string): string {
  return time === "24:00" ? "midnight" : time;
}

// One day's hours in words: "12:00 to 15:00 and 18:00 to 23:00", or "Closed".
export function describeDay(ranges: TimeRange[]): string {
  if (ranges.length === 0) {
    return "Closed";
  }
  return ranges.map((range) => `${formatTime(range.opens)} to ${formatTime(range.closes)}`).join(" and ");
}

// The weekday and minutes at this moment in the restaurant's time zone.
function localNow(timeZone: string, now: Date): { day: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  const day = part("weekday").toLowerCase().slice(0, 3) as Weekday;
  return { day, minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}

// Today's hours as the sidebar says them: "Open all day", "Open until
// 23:00", "Opens at 18:00", "Closed now" or "Closed today", in the
// restaurant's own time zone.
export function describeHoursNow(hours: OpeningHours, timeZone: string, now: Date): { open: boolean; text: string } {
  const { day, minutes } = localNow(timeZone, now);
  const today = hours[day] ?? [];
  if (today.length === 0) {
    return { open: false, text: "Closed today" };
  }
  const current = today.find((range) => minutesOf(range.opens) <= minutes && minutes < minutesOf(range.closes));
  if (current && current.opens === "00:00" && current.closes === "24:00") {
    return { open: true, text: "Open all day" };
  }
  if (current) {
    return { open: true, text: `Open until ${formatTime(current.closes)}` };
  }
  const later = today.find((range) => minutesOf(range.opens) > minutes);
  if (later) {
    return { open: false, text: `Opens at ${formatTime(later.opens)}` };
  }
  return { open: false, text: "Closed now" };
}

// The year, month, day and time at this moment in a time zone.
function localDateTime(timeZone: string, at: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

// How far the zone's clock is ahead of UTC at this moment, in milliseconds.
function zoneOffsetMs(timeZone: string, at: Date): number {
  const local = localDateTime(timeZone, at);
  const asIfUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// The moment the restaurant's current day ends: its next midnight, in its own
// time zone. "Not available today" lasts until then (step 46). The midnight
// is first placed as if the zone were UTC, then moved by the zone's offset,
// twice, so a clock change that night still lands it right.
export function endOfLocalDay(timeZone: string, now: Date): Date {
  const today = localDateTime(timeZone, now);
  const midnightAsIfUtc = Date.UTC(today.year, today.month - 1, today.day + 1);
  let moment = midnightAsIfUtc;
  for (let pass = 0; pass < 2; pass++) {
    moment = midnightAsIfUtc - zoneOffsetMs(timeZone, new Date(moment));
  }
  return new Date(moment);
}
