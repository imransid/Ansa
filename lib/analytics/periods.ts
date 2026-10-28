import type { AnalyticsPeriod } from "./kinds";

// The moments a period of the Analytics page (step 42) runs between: the
// posts published from `days` days ago until now. Pure.

const DAY_MS = 24 * 60 * 60 * 1000;

export type PeriodBounds = { days: number; start: Date; end: Date };

export function periodBounds(period: AnalyticsPeriod, now: Date): PeriodBounds {
  const days = Number(period);
  return { days, start: new Date(now.getTime() - days * DAY_MS), end: now };
}
