import { FilterLinks } from "@/components/filter-links";
import { SearchBox } from "@/components/search-box";
import { buildListUrl } from "@/lib/pagination";
import { ticketViews, type TicketListQuery, type TicketView } from "@/lib/validation/list-queries";
import type { TicketViewCounts } from "@/services/tickets";

const VIEW_LABELS: Record<TicketView, string> = {
  open: "Open",
  mine: "Mine",
  unassigned: "Unassigned",
  solved: "Solved",
  all: "All",
};

type TicketViewsProps = {
  query: TicketListQuery;
  counts: TicketViewCounts;
};

// The ticket list's views as plain links with how many tickets each holds,
// and the search box (step 29). The links keep the search, so "Solved (2)"
// opens the 2 solved tickets the search found.
export function TicketViews({ query, counts }: TicketViewsProps) {
  const links = ticketViews.map((view) => ({
    label: `${VIEW_LABELS[view]} (${counts[view]})`,
    href: buildListUrl("/dashboard", { view, q: query.search }),
    isCurrent: view === query.view,
    // Nobody is told about these, so they must stand out here.
    needsAttention: view === "unassigned" && counts.unassigned > 0,
  }));

  return (
    <div className="grid gap-3">
      <FilterLinks label="Ticket views" links={links} />
      {/* WHY the search covers all tickets: a customer calling back is
          usually looking for an older, solved or someone else's ticket. The
          links above then narrow it down. */}
      <SearchBox
        action="/dashboard"
        label="Search all tickets"
        placeholder="Number, subject, customer name, email or phone"
        search={query.search}
        hiddenFields={{ view: "all" }}
        clearHref={buildListUrl("/dashboard", { view: query.view })}
      />
    </div>
  );
}
