import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PaginationLinks } from "@/components/pagination-links";
import { buttonVariants } from "@/components/ui/button";
import { canManageKnowledge } from "@/lib/knowledge/permissions";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { parseKnowledgeListQuery } from "@/lib/validation/list-queries";
import { countKnowledgeArticlesForSession, listKnowledgeArticlesForSession } from "@/services/knowledge";
import { ArticleTable } from "./article-table";
import { KnowledgeFilters } from "./knowledge-filters";
import { KnowledgeListEmpty } from "./knowledge-list-empty";
import { TestSearchBox } from "./test-search-box";

export const metadata: Metadata = { title: "Knowledge - ansa" };

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
  const session = await requireSessionContext("/knowledge");
  const [articles, counts, everyArticle] = await Promise.all([
    listKnowledgeArticlesForSession(session, page, query),
    countKnowledgeArticlesForSession(session, query.search),
    // Without the search: whether the company has any article at all.
    query.search ? countKnowledgeArticlesForSession(session) : null,
  ]);
  // Hiding the buttons is only for a tidy page: the services refuse members.
  const isOwner = canManageKnowledge(session.role);
  const totalArticles = (everyArticle ?? counts).all;

  return (
    <>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Knowledge</h1>
          <div className="flex flex-wrap gap-2">
            {isOwner && (
              <Link href="/knowledge/import" className={buttonVariants({ size: "sm", variant: "outline" })}>
                Import a web page
              </Link>
            )}
            <Link href="/knowledge/new" className={buttonVariants({ size: "sm" })}>
              New article
            </Link>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          What your team knows about your products, policies and common problems, written down once. Anyone can write
          drafts; only articles an owner approved show on tickets or are ever given to the AI. During phone calls the
          AI assistant looks up approved support articles and may read them to callers word for word; it doesn&apos;t
          use them for emails yet.
        </p>
        {totalArticles > 0 && <KnowledgeFilters query={query} counts={counts} />}
        {articles.length > 0 ? (
          <ArticleTable articles={articles} />
        ) : (
          <KnowledgeListEmpty query={query} page={page} totalArticles={totalArticles} isOwner={isOwner} />
        )}
        <PaginationLinks basePath="/knowledge" page={page} totalRows={counts[query.status]} query={{ status: query.status, q: query.search }} />
      </section>
      {totalArticles > 0 && <TestSearchBox />}
    </>
  );
}
