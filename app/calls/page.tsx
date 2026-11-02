import { Suspense } from "react";
import type { Metadata } from "next";
import { PaginationLinks } from "@/components/pagination-links";
import { getCallsAndCountsFromCore } from "@/lib/core-views/calls";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { parseCallListQuery } from "@/lib/validation/list-queries";
import { CallFilters } from "./call-filters";
import { CallsTable } from "./calls-table";

export const metadata: Metadata = { title: "Calls - ansa" };

export default function CallsPage({ searchParams }: PageProps<"/calls">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: anything that reads the session or the URL's
          ?outcome=, ?q= and ?page= must sit inside <Suspense>, because it can
          only run at request time. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <CallsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function CallsContent({ searchParams }: Pick<PageProps<"/calls">, "searchParams">) {
  const urlQuery = await searchParams;
  const page = parsePageNumber(urlQuery.page);
  const query = parseCallListQuery(urlQuery);
  await requireSessionContext("/calls");
  const [calls, counts] = await getCallsAndCountsFromCore(page, query);

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Calls</h1>
        <CallFilters query={query} counts={counts} />
        <CallsTable calls={calls} page={page} query={query} />
        <PaginationLinks
          basePath="/calls"
          page={page}
          totalRows={counts[query.outcome]}
          query={{ outcome: query.outcome, q: query.search }}
        />
      </section>
    </>
  );
}
