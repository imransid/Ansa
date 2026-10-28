// What the Co-Founder's analytics (step 42) works with: where a post's
// numbers came from, and the periods the Analytics page shows. A file of
// its own with no imports, so the pages, the database schema
// (db/schema/post-metrics.ts, whose CHECK lists the same sources; a check
// proves they agree) and the simulate command read one list.

// platform: read from the platform by the collector. dev_simulated: written
// by `pnpm simulate:post-metrics` for a development stand-in's post, and
// labeled "Simulated (development)" wherever it shows.
export const postMetricSources = ["platform", "dev_simulated"] as const;
export type PostMetricSource = (typeof postMetricSources)[number];

export const SIMULATED_LABEL = "Simulated (development)";

// The Analytics page's periods: the posts published in the last 7, 30 or
// 90 days (?period=7). 30 when the address names none, or an odd one.
export const analyticsPeriods = ["7", "30", "90"] as const;
export type AnalyticsPeriod = (typeof analyticsPeriods)[number];
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = "30";

export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
};
