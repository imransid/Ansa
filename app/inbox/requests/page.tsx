import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageLoading } from "@/components/page-loading";
import { PaginationLinks } from "@/components/pagination-links";
import { buttonVariants } from "@/components/ui/button";
import { listRequestsFromCore } from "@/lib/core-views/tickets";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { defaultTicketViewFor, parseTicketListQuery } from "@/lib/validation/list-queries";
import { TicketListEmpty } from "./ticket-list-empty";
import { TicketTable } from "./ticket-table";
import { TicketViews } from "./ticket-views";

export const metadata: Metadata = { title: "All requests - ansa" };

// All requests (the Inbox's ticket list since step 47; the dashboard's
// before step 44): every ticket with its views, search and pages, also the
// ones without a conversation (typed in, from a hidden number). Step 58
// decides where it lives in the end.
export default function AllRequestsPage({ searchParams }: PageProps<"/inbox/requests">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's ?view=, ?q= and
          ?page= are only known at request time, so all are read inside <Suspense>. */}
      <Suspense fallback={<PageLoading />}>
        <RequestsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Reads the session once and hands it to everything on the page.
async function RequestsContent({ searchParams }: Pick<PageProps<"/inbox/requests">, "searchParams">) {
  const urlQuery = await searchParams;
  const page = parsePageNumber(urlQuery.page);
  const session = await requireSessionContext("/inbox/requests");
  const query = parseTicketListQuery(urlQuery, defaultTicketViewFor(session.role));
  const { tickets, counts } = await listRequestsFromCore(page, query);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <Link href="/inbox" className="text-sm text-muted-foreground hover:underline">
            &larr; Inbox
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">All requests</h1>
          <p className="text-sm text-muted-foreground">
            Requests that need a person, from calls, emails and your team. Also see{" "}
            <Link href="/calls" className="underline hover:text-foreground">
              calls
            </Link>{" "}
            and{" "}
            <Link href="/emails" className="underline hover:text-foreground">
              received emails
            </Link>
            .
          </p>
        </div>
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
      <PaginationLinks basePath="/inbox/requests" page={page} totalRows={counts[query.view]} query={{ view: query.view, q: query.search }} />
    </>
  );
}
