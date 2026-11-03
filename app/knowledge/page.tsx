import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PaginationLinks } from "@/components/pagination-links";
import { buttonVariants } from "@/components/ui/button";
import { getAccountKindFromCore } from "@/lib/core-views/inbox";
import { getKnowledgeListFromCore } from "@/lib/core-views/knowledge";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { parseKnowledgeListQuery, type KnowledgeListQuery } from "@/lib/validation/list-queries";
import { ArticleTable } from "./article-table";
import { KnowledgeFilters } from "./knowledge-filters";
import { KnowledgeListEmpty } from "./knowledge-list-empty";
import { TestSearchBox } from "./test-search-box";

export const metadata: Metadata = { title: "Saved answers - ansa" };

export default function KnowledgePage({ searchParams }: PageProps<"/knowledge">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's ?status=, ?q= and
          ?page= are only known at request time, so all are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <KnowledgeContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// The company's knowledge base (step 34): every article, the search box for
// titles, and "Test what the AI finds".
async function KnowledgeContent({ searchParams }: Pick<PageProps<"/knowledge">, "searchParams">) {
  const urlQuery = await searchParams;
  const page = parsePageNumber(urlQuery.page);
  const query = parseKnowledgeListQuery(urlQuery);
  await requireSessionContext("/knowledge");
  // Hiding the buttons is only for a tidy page: both refuse members.
  const [{ articles, counts, totalArticles, isOwner }, kind] = await Promise.all([getListFromCore(page, query), getAccountKindFromCore()]);
  // One person's account (step 50): Settings calls these "Saved answers".
  const personal = kind === "personal";

  return (
    <>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Saved answers</h1>
          <div className="flex flex-wrap gap-2">
            {isOwner && (
              <Link href="/knowledge/import" className={buttonVariants({ size: "sm", variant: "outline" })}>
                Import a web page
              </Link>
            )}
            <Link href="/knowledge/new" className={buttonVariants({ size: "sm" })}>
              New saved answer
            </Link>
          </div>
        </div>
        {personal ? (
          <p className="text-sm text-muted-foreground">
            What ansa may tell people about you, written down once: what you do, your rates, how and when to reach you,
            the answers you give again and again. Only the ones you approved are ever given to the AI. Before each
            answer in a chat or a phone call, ansa&apos;s assistant reads the approved ones that best match the
            message (3 at most) and may quote them word for word, prices and links included. It doesn&apos;t use them
            for emails yet.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            What your team knows about your products, policies and common problems, written down once. Anyone can write
            drafts; only articles an owner approved show on requests or are ever given to the AI. Before each answer in
            a chat or a phone call, ansa&apos;s assistant reads the approved support articles that best match the
            customer&apos;s message (3 at most) and may quote them to the customer word for word, prices and links
            included. It doesn&apos;t use them for emails yet.
          </p>
        )}
        {totalArticles > 0 && <KnowledgeFilters query={query} counts={counts} />}
        {articles.length > 0 ? (
          <ArticleTable articles={articles} />
        ) : (
          <KnowledgeListEmpty query={query} page={page} totalArticles={totalArticles} isOwner={isOwner} personal={personal} />
        )}
        <PaginationLinks basePath="/knowledge" page={page} totalRows={counts[query.status]} query={{ status: query.status, q: query.search }} />
      </section>
      {totalArticles > 0 && <TestSearchBox personal={personal} />}
    </>
  );
}

// The page's list from core.
async function getListFromCore(page: number, query: KnowledgeListQuery) {
  const [list, everyArticle] = await Promise.all([
    getKnowledgeListFromCore(page, query),
    // Without the search: whether the company has any article at all.
    query.search ? getKnowledgeListFromCore(1, { status: "all", search: null }) : null,
  ]);
  return { articles: list.articles, counts: list.counts, totalArticles: (everyArticle ?? list).counts.all, isOwner: list.isOwner };
}
