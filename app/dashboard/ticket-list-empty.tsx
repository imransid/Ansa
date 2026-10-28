import type { ReactNode } from "react";
import Link from "next/link";
import { buildListUrl } from "@/lib/pagination";
import type { TicketListQuery, TicketView } from "@/lib/validation/list-queries";

// What an empty view says (step 29): an empty "Mine" is good news, an empty
// "Unassigned" means every open ticket has someone.
const EMPTY_VIEW_TEXT: Record<TicketView, string> = {
  open: "No open tickets.",
  mine: "No open tickets are assigned to you.",
  unassigned: "Every open ticket has someone working on it.",
  solved: "No solved tickets yet.",
  all: "No tickets yet.",
};

type TicketListEmptyProps = {
  query: TicketListQuery;
  page: number;
  // How many tickets the company has (that the search finds, when searching).
  totalTickets: number;
  // Owners: only they can change the setup that makes tickets arrive.
  canSetUp: boolean;
};

// Shown instead of the ticket table when the list on screen has no rows.
export function TicketListEmpty({ query, page, totalTickets, canSetUp }: TicketListEmptyProps) {
  if (page > 1) {
    return (
      <EmptyBox>
        Nothing on this page.{" "}
        <Link href={buildListUrl("/dashboard", { view: query.view, q: query.search })} className="underline">
          Go to the first page
        </Link>
      </EmptyBox>
    );
  }
  if (query.search) {
    return (
      <EmptyBox>
        No tickets {query.view === "all" ? "" : "in this view "}match &ldquo;{query.search}&rdquo;.{" "}
        <Link href={buildListUrl("/dashboard", { view: query.view })} className="underline">
          Clear search
        </Link>
      </EmptyBox>
    );
  }
  // A new company lands here first, and nothing can arrive until its support
  // email is forwarded to ansa, so point owners to the page with that address.
  // Members can't change the setup: they are only told what to expect.
  if (totalTickets === 0) {
    return (
      <EmptyBox>
        No tickets yet. Tickets appear here when the AI can&apos;t solve a customer&apos;s problem.
        {canSetUp && (
          <>
            {" "}
            <Link href="/setup" className="underline">
              Finish setting up
            </Link>
            : forward your support email to the address on the Setup page.
          </>
        )}
      </EmptyBox>
    );
  }
  return <EmptyBox>{EMPTY_VIEW_TEXT[query.view]}</EmptyBox>;
}

function EmptyBox({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border p-6 text-center text-muted-foreground">{children}</p>;
}
