import { FilterLinks } from "@/components/filter-links";
import { SearchBox } from "@/components/search-box";
import { buildListUrl } from "@/lib/pagination";
import { callOutcomeFilters, type CallListQuery, type CallOutcomeFilter } from "@/lib/validation/list-queries";
import type { CallOutcomeCounts } from "@/services/calls";

const FILTER_LABELS: Record<CallOutcomeFilter, string> = {
  all: "All",
  solved: "Solved by the AI",
  needs_human: "Needs a human",
  stuck: "Stuck",
};

type CallFiltersProps = {
  query: CallListQuery;
  counts: CallOutcomeCounts;
};

// The Calls list's filters by what the AI decided, as plain links with how
// many calls each holds, and the caller number search (step 29). The links
// keep the search.
export function CallFilters({ query, counts }: CallFiltersProps) {
  const links = callOutcomeFilters.map((outcome) => ({
    label: `${FILTER_LABELS[outcome]} (${counts[outcome]})`,
    href: buildListUrl("/calls", { outcome, q: query.search }),
    isCurrent: outcome === query.outcome,
    // A stuck call has no decision and maybe no ticket until someone acts.
    needsAttention: outcome === "stuck" && counts.stuck > 0,
  }));

  return (
    <div className="grid gap-3">
      <FilterLinks label="Call filters" links={links} />
      <SearchBox
        action="/calls"
        label="Search calls by caller number"
        placeholder="Caller number"
        search={query.search}
        hiddenFields={{ outcome: "all" }}
        clearHref={buildListUrl("/calls", { outcome: query.outcome })}
      />
    </div>
  );
}
