import { FilterLinks } from "@/components/filter-links";
import { ANALYTICS_PERIOD_LABELS, analyticsPeriods, type AnalyticsPeriod } from "@/lib/analytics/kinds";
import { buildListUrl } from "@/lib/pagination";

// The Analytics page's periods (step 42): the posts that went out in the
// last 7, 30 or 90 days, the open one marked.
export function PeriodLinks({ period }: { period: AnalyticsPeriod }) {
  const links = analyticsPeriods.map((candidate) => ({
    label: ANALYTICS_PERIOD_LABELS[candidate],
    href: buildListUrl("/cofounder/analytics", { period: candidate }),
    isCurrent: candidate === period,
  }));
  return <FilterLinks label="Period" links={links} />;
}
