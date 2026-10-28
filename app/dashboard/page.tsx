import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PaginationLinks } from "@/components/pagination-links";
import { buttonVariants } from "@/components/ui/button";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { defaultTicketViewFor, parseTicketListQuery } from "@/lib/validation/list-queries";
import { getBusinessOverviewForSession } from "@/services/business-overview";
import { getFirstRunHintsForSession } from "@/services/dashboard";
import { countTicketsPerViewForSession, listTicketsForSession } from "@/services/tickets";
import { countUndeliveredCustomerEmailsForSession } from "@/services/undelivered-emails";
import { BusinessOverviewPanel } from "./business-overview";
import { FirstRunNotices } from "./first-run-notices";
import { TicketListEmpty } from "./ticket-list-empty";
import { TicketTable } from "./ticket-table";
import { TicketViews } from "./ticket-views";

// The tab says what the page and the header call it.
export const metadata: Metadata = { title: "Tickets - ansa" };

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's ?view=, ?q= and
          ?page= are only known at request time, so all are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Reads the session once and hands it to everything on the page.
async function DashboardContent({ searchParams }: Pick<PageProps<"/dashboard">, "searchParams">) {
  const urlQuery = await searchParams;
  const page = parsePageNumber(urlQuery.page);
  const session = await requireSessionContext("/dashboard");
  const query = parseTicketListQuery(urlQuery, defaultTicketViewFor(session.role));
  const [tickets, counts, undeliveredEmails, hints, overview] = await Promise.all([
    listTicketsForSession(session, page, query),
    countTicketsPerViewForSession(session, query.search),
    countUndeliveredCustomerEmailsForSession(session),
    getFirstRunHintsForSession(session),
    getBusinessOverviewForSession(session),
  ]);

  return (
    <>
      <FirstRunNotices hints={hints} />
      <UndeliveredEmailsNotice count={undeliveredEmails} />
      {/* Step 43: both halves of ansa at a glance, above the ticket list. */}
      <BusinessOverviewPanel overview={overview} />
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Tickets</h2>
          {/* For requests that reach the team another way (step 31). */}
          <Link href="/tickets/new" className={buttonVariants({ size: "sm" })}>
            New ticket
          </Link>
        </div>
        <TicketViews query={query} counts={counts} />
        {tickets.length > 0 ? (
          <TicketTable tickets={tickets} />
        ) : (
          <TicketListEmpty query={query} page={page} totalTickets={counts.all} canSetUp={session.role === "owner"} />
        )}
        <PaginationLinks
          basePath="/dashboard"
          page={page}
          totalRows={counts[query.view]}
          query={{ view: query.view, q: query.search }}
        />
      </section>
    </>
  );
}

// Customers who were never told their request is solved (step 27): otherwise
// that only shows on each ticket's own page, which nobody opens again.
function UndeliveredEmailsNotice({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }
  return (
    <p role="status" className="rounded-lg border border-destructive/50 p-3 text-sm">
      {count === 1 ? "1 customer email was" : `${count} customer emails were`} not delivered.{" "}
      <Link href="/emails" className="font-medium underline">
        See which on the Emails page
      </Link>
    </p>
  );
}
