import { FilterLinks } from "@/components/filter-links";
import { SearchBox } from "@/components/search-box";
import { buildListUrl } from "@/lib/pagination";
import { knowledgeStatusFilters, type KnowledgeListQuery, type KnowledgeStatusFilter } from "@/lib/validation/list-queries";
import type { KnowledgeStatusCounts } from "@/services/knowledge";

const FILTER_LABELS: Record<KnowledgeStatusFilter, string> = {
  all: "All",
  draft: "Drafts",
  approved: "Approved",
  archived: "Archived",
};

type KnowledgeFiltersProps = {
  query: KnowledgeListQuery;
  counts: KnowledgeStatusCounts;
};

// The Knowledge list's filters by status, as plain links with how many
// articles each holds, and the title search. The links keep the search.
export function KnowledgeFilters({ query, counts }: KnowledgeFiltersProps) {
  const links = knowledgeStatusFilters.map((status) => ({
    label: `${FILTER_LABELS[status]} (${counts[status]})`,
    href: buildListUrl("/knowledge", { status, q: query.search }),
    isCurrent: status === query.status,
    // Drafts wait for an owner: the AI uses none of them until then.
    needsAttention: status === "draft" && counts.draft > 0,
  }));

  return (
    <div className="grid gap-3">
      <FilterLinks label="Knowledge filters" links={links} />
      <SearchBox
        action="/knowledge"
        label="Search article titles"
        placeholder="Words in the title"
        search={query.search}
        hiddenFields={{ status: "all" }}
        clearHref={buildListUrl("/knowledge", { status: query.status })}
      />
    </div>
  );
}
