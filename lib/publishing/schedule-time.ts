import { SCHEDULE_MAX_AHEAD_DAYS, SCHEDULE_PAST_GRACE_MS } from "./limits";

// Times of the publishing queue and the calendar (step 41): stored in UTC,
// typed and shown in the viewer's own timezone. The browser turns the date
// and time a person typed into one UTC instant before sending it
// (wallClockToUtc, in the form's onSubmit), so the server never guesses
// anyone's timezone. Pure: the browser, the services and the checks use the
// same functions.

// A date and a time as <input type="date"> and <input type="time"> give
// them: "2026-11-03" and "09:30".
export type WallClock = { date: string; time: string };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
// IANA names ("Europe/Lisbon", "America/Argentina/Buenos_Aires") and "UTC".
const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,100}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Whether this is a timezone the browser or the server knows by name.
export function isKnownTimeZone(timeZone: string): boolean {
  if (!TIME_ZONE_PATTERN.test(timeZone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The UTC instant a wall-clock time in a timezone stands for, or null for a
// date, time or timezone that doesn't exist. Around a clock change: a time
// that happens twice (clocks going back) is the first of the two, and one
// that never happens (clocks jumping forward) is the moment it would have
// been, after the jump (02:30 on the night clocks go from 02:00 to 03:00 is
// 03:30), as browsers read such a time too.
export function wallClockToUtc(wallClock: WallClock, timeZone: string): Date | null {
  const naive = naiveUtcOf(wallClock);
  if (naive === null || !isKnownTimeZone(timeZone)) {
    return null;
  }
  // The zone's offset a day before and a day after: they differ only around a clock change.
  const offsetBefore = offsetMinutesAt(naive - DAY_MS, timeZone);
  const offsetAfter = offsetMinutesAt(naive + DAY_MS, timeZone);
  const candidates = [naive - offsetBefore * 60_000, naive - offsetAfter * 60_000];
  const typed = `${wallClock.date}T${wallClock.time}`;
  const matching = candidates.filter((instant) => wallClockAt(instant, timeZone) === typed);
  return new Date(matching.length > 0 ? Math.min(...matching) : candidates[0]);
}

// The date ("2026-11-03") an instant falls on in a timezone.
export function localDateOf(instant: Date, timeZone: string): string {
  return wallClockAt(instant.getTime(), timeZone).slice(0, 10);
}

// The time ("09:30") an instant shows in a timezone.
export function localTimeOf(instant: Date, timeZone: string): string {
  return wallClockAt(instant.getTime(), timeZone).slice(11, 16);
}

// The date this many days after another (calendar days, whatever the clocks do).
export function addDays(date: string, days: number): string {
  const naive = naiveUtcOf({ date, time: "00:00" });
  return naive === null ? date : new Date(naive + days * DAY_MS).toISOString().slice(0, 10);
}

// "Monday" for a date.
export function weekdayOf(date: string): string {
  const naive = naiveUtcOf({ date, time: "00:00" });
  return naive === null ? "" : WEEKDAYS[new Date(naive).getUTCDay()];
}

// Whether a post may be scheduled for this moment: not further back than a
// minute (the form took a moment), not more than a year ahead.
export function checkScheduleTime(at: Date, now: Date): "ok" | "past" | "too_far" {
  if (at.getTime() < now.getTime() - SCHEDULE_PAST_GRACE_MS) {
    return "past";
  }
  return at.getTime() > now.getTime() + SCHEDULE_MAX_AHEAD_DAYS * DAY_MS ? "too_far" : "ok";
}

// The wall clock read as if it were UTC, in milliseconds, or null when it
// isn't a real date and time (2026-02-30, 24:00).
function naiveUtcOf(wallClock: WallClock): number | null {
  const date = DATE_PATTERN.exec(wallClock.date);
  const time = TIME_PATTERN.exec(wallClock.time);
  if (!date || !time) {
    return null;
  }
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const naive = Date.UTC(year, month - 1, day, Number(time[1]), Number(time[2]));
  const check = new Date(naive);
  const isRealDate = check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
  return isRealDate ? naive : null;
}

// How far the timezone's clocks are ahead of UTC at this instant, in minutes.
function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const shown = partsAt(instantMs, timeZone);
  const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
  return Math.round((shownAsUtc - Math.floor(instantMs / 1000) * 1000) / 60_000);
}

// "2026-11-03T09:30": what a clock in the timezone shows at this instant.
function wallClockAt(instantMs: number, timeZone: string): string {
  const shown = partsAt(instantMs, timeZone);
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return `${String(shown.year).padStart(4, "0")}-${twoDigits(shown.month)}-${twoDigits(shown.day)}T${twoDigits(shown.hour)}:${twoDigits(shown.minute)}`;
}

function partsAt(instantMs: number, timeZone: string) {
  // hourCycle h23: midnight is 00, never 24.
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = format.formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}
