import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/analytics/format";
import { SIMULATED_LABEL } from "@/lib/analytics/kinds";
import type { MetricTotal } from "@/lib/analytics/totals";
import { metricColumns, metricLabel } from "@/lib/metric-definitions";
import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/lib/social-platforms";
import type { PlatformTotals } from "@/services/analytics-page";

// The period's totals per platform (step 42): each number the platform
// has, added up over its posts' latest numbers. One it doesn't give says
// so, never 0; one ansa doesn't read yet says why.
export function PlatformTotalsList({ totals }: { totals: PlatformTotals[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {totals.map((platformTotals) => {
        const platformLabel = SOCIAL_PLATFORM_LABELS[platformTotals.platform];
        return (
          <li key={platformTotals.platform} className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{platformLabel}</h3>
              {platformTotals.simulated && <Badge variant="outline">{SIMULATED_LABEL}</Badge>}
            </div>
            <p className="text-muted-foreground">
              {platformTotals.posts} {platformTotals.posts === 1 ? "post" : "posts"}, {platformTotals.postsWithNumbers} with numbers.
            </p>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
              {metricColumns.map((column) => (
                <div key={column} className="contents">
                  <dt className="text-muted-foreground">{metricLabel(platformTotals.platform, column)}</dt>
                  <dd className="text-right">
                    <TotalValue total={platformTotals.metrics[column]} platform={platformTotals.platform} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

function TotalValue({ total, platform }: { total: MetricTotal; platform: SocialPlatform }) {
  switch (total.kind) {
    case "total":
      return <span className="font-medium tabular-nums">{formatNumber(total.value)}</span>;
    case "not_offered":
      return <span className="text-muted-foreground">Not available on {SOCIAL_PLATFORM_LABELS[platform]}</span>;
    case "not_collected":
      return <span className="text-muted-foreground">Not read yet (needs a permission)</span>;
    case "no_numbers_yet":
      return <span className="text-muted-foreground">No numbers yet</span>;
  }
}
