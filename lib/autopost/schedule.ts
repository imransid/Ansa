import { addDays, localDateOf, wallClockToUtc, weekdayOf } from "@/lib/publishing/schedule-time";

// "Post for me" (step 54): how often ansa posts on the business's Facebook
// Page and when, in the business's own time zone. Pure.

export const AUTOPOST_FREQUENCIES = ["daily", "three_a_week", "weekly"] as const;
export type AutopostFrequency = (typeof AUTOPOST_FREQUENCIES)[number];

export const AUTOPOST_FREQUENCY_LABELS: Record<AutopostFrequency, string> = {
  daily: "Every day",
  three_a_week: "3 times a week (Monday, Wednesday, Friday)",
  weekly: "Once a week (Friday)",
};

// "automatic": ansa posts by itself. "ask_first": each post waits for an
// owner's approval in Social media posts.
export const AUTOPOST_MODES = ["automatic", "ask_first"] as const;
export type AutopostMode = (typeof AUTOPOST_MODES)[number];

const POSTING_DAYS: Record<AutopostFrequency, string[]> = {
  daily: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  three_a_week: ["Monday", "Wednesday", "Friday"],
  weekly: ["Friday"],
};

// How far ahead ansa writes a post: a day, so the owner sees it coming
// (and can cancel it), and a daily job alone still finds every one.
export const WRITE_AHEAD_MS = 24 * 60 * 60 * 1000;

// The next posting moments after `from`, in UTC, at the business's chosen
// local time on its posting days.
export function nextPostingTimes(frequency: AutopostFrequency, time: string, timeZone: string, from: Date, count: number): Date[] {
  const times: Date[] = [];
  let date = localDateOf(from, timeZone);
  for (let day = 0; day < 15 && times.length < count; day++, date = addDays(date, 1)) {
    if (!POSTING_DAYS[frequency].includes(weekdayOf(date))) {
      continue;
    }
    const at = wallClockToUtc({ date, time }, timeZone);
    if (at && at.getTime() > from.getTime()) {
      times.push(at);
    }
  }
  return times;
}

// The next posting moment whose post ansa should write now: within the
// next day. null when none is that close.
export function postingTimeToWrite(frequency: AutopostFrequency, time: string, timeZone: string, now: Date): Date | null {
  const [next] = nextPostingTimes(frequency, time, timeZone, now, 1);
  return next && next.getTime() - now.getTime() <= WRITE_AHEAD_MS ? next : null;
}
