import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PaginationLinks } from "@/components/pagination-links";
import { buttonVariants } from "@/components/ui/button";
import { canReviewContentDrafts } from "@/lib/cofounder/permissions";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { parseContentDraftListQuery } from "@/lib/validation/list-queries";
import { countContentDraftsForSession, listContentDraftsForSession } from "@/services/content-drafts";
import { DraftTable } from "./draft-table";
import { StudioFilters } from "./studio-filters";
import { StudioListEmpty } from "./studio-list-empty";

export const metadata: Metadata = { title: "Studio - Co-Founder - ansa" };

export default function StudioPage({ searchParams }: PageProps<"/cofounder/studio">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's ?status=,
          ?platform= and ?page= are only known at request time, so all are
          read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <StudioContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// The company's content drafts (step 38): every post being written, its
// platform and status, filtered by status and platform, 50 to a page.
async function StudioContent({ searchParams }: Pick<PageProps<"/cofounder/studio">, "searchParams">) {
  const urlQuery = await searchParams;
  const page = parsePageNumber(urlQuery.page);
  const query = parseContentDraftListQuery(urlQuery);
  const session = await requireSessionContext("/cofounder/studio");
  const [drafts, counts, everyPlatform] = await Promise.all([
    listContentDraftsForSession(session, page, query),
    countContentDraftsForSession(session, query.platform),
    // Without the platform filter: whether the company has any draft at all.
    query.platform === "all" ? null : countContentDraftsForSession(session, "all"),
  ]);
  const totals = everyPlatform ?? counts;
  const totalDrafts = totals.current + totals.archived;

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Content studio</h1>
        <Link href="/cofounder/studio/new" className={buttonVariants({ size: "sm" })}>
          New draft
        </Link>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Posts for LinkedIn, Facebook, X and YouTube, each written for its platform by the AI from your confirmed facts, or
        by your team. Every draft is checked against the platform&apos;s rules and your words to avoid, and lists the
        claims it makes about your business.{" "}
        {canReviewContentDrafts(session.role)
          ? "Nothing is published without an owner's approval."
          : "Nothing is published without an owner's approval: owners approve or reject drafts."}{" "}
        An approved draft is scheduled from its page, and goes out through the{" "}
        <Link href="/cofounder/queue" className="underline">
          queue
        </Link>
        .
      </p>
      {totalDrafts > 0 && <StudioFilters query={query} counts={counts} />}
      {drafts.length > 0 ? (
        <DraftTable drafts={drafts} />
      ) : (
        <StudioListEmpty query={query} page={page} counts={counts} totalDrafts={totalDrafts} />
      )}
      <PaginationLinks
        basePath="/cofounder/studio"
        page={page}
        totalRows={counts[query.status]}
        query={{ status: query.status, platform: query.platform }}
      />
    </section>
  );
}
