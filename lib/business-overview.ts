// The dashboard's "Business overview" (step 43): how far its counts read and
// look, and how a count is written. Pure, so the page, /db and the checks
// share one set of numbers.

// Each count of the overview reads at most one row more than this
// (db/business-overview.ts), so the page costs a company with years of
// tickets no more than a new one. A count past it shows as "10,000+": the
// list the number links to has the exact one.
export const OVERVIEW_COUNT_LIMIT = 10_000;

// "Calls in the last 7 days", "posts scheduled for the next 7 days", ...
export const OVERVIEW_WINDOW_DAYS = 7;

// "1,234", or "10,000+" for a count that read past the limit.
export function formatOverviewCount(count: number): string {
  if (count > OVERVIEW_COUNT_LIMIT) {
    return `${OVERVIEW_COUNT_LIMIT.toLocaleString("en-US")}+`;
  }
  return count.toLocaleString("en-US");
}

// "1 open ticket", "2 open tickets", "10,000+ open tickets".
export function countWithNoun(count: number, singular: string, plural: string): string {
  return `${formatOverviewCount(count)} ${count === 1 ? singular : plural}`;
}
