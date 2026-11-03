import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { FilterLinks } from "@/components/filter-links";
import { PageLoading } from "@/components/page-loading";
import { PaginationLinks } from "@/components/pagination-links";
import { RefreshEvery } from "@/components/refresh-every";
import { buttonVariants } from "@/components/ui/button";
import { getAccountKindFromCore, getInboxFromCore } from "@/lib/core-views/inbox";
import { parseInboxView } from "@/lib/inbox";
import { buildListUrl, parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { ConversationList } from "./conversation-list";

export const metadata: Metadata = { title: "Inbox - ansa" };

// The Inbox (step 47): every conversation with a customer, on a chat channel,
// by phone or by email, the latest first. "Needs you" holds the ones with an
// open request. Every request is still listed in All requests.
export default function InboxPage({ searchParams }: PageProps<"/inbox">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's ?view= and ?page=
          are only known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<PageLoading />}>
        <InboxContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function InboxContent({ searchParams }: Pick<PageProps<"/inbox">, "searchParams">) {
  const urlQuery = await searchParams;
  const view = parseInboxView(urlQuery.view);
  const page = parsePageNumber(urlQuery.page);
  await requireSessionContext("/inbox");
  const [{ rows, counts }, kind] = await Promise.all([getInboxFromCore(view, page), getAccountKindFromCore()]);
  const personal = kind === "personal";
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {personal ? "Everyone who wrote to you, newest first." : "Your customers' conversations, newest first."} Also see{" "}
            <Link href="/inbox/requests" className="underline hover:text-foreground">
              all requests
            </Link>
            ,{" "}
            {/* Comments on a business's Facebook Page posts. */}
            {!personal && (
              <>
                <Link href="/inbox/comments" className="underline hover:text-foreground">
                  comments on your Facebook posts
                </Link>
                ,{" "}
              </>
            )}
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
        {/* For requests that reach the team another way (step 31). A
            person's account has no team to hand them to. */}
        {!personal && (
          <Link href="/tickets/new" className={buttonVariants({ size: "sm", variant: "outline" })}>
            New request
          </Link>
        )}
      </div>
      {/* New messages and ansa's replies show up by themselves. */}
      <RefreshEvery seconds={5} />
      <FilterLinks
        label="Inbox views"
        links={[
          { label: `Needs you (${counts["needs-you"]})`, href: buildListUrl("/inbox", { view: "needs-you" }), isCurrent: view === "needs-you", needsAttention: counts["needs-you"] > 0 },
          { label: `All (${counts.all})`, href: buildListUrl("/inbox", { view: "all" }), isCurrent: view === "all" },
        ]}
      />
      {rows.length > 0 ? (
        <ConversationList rows={rows} />
      ) : (
        <EmptyState>
          {view === "needs-you"
            ? "Nothing needs you. When ansa can't answer someone, they show here."
            : "No conversations yet. Messages, calls and emails show here as they arrive."}
        </EmptyState>
      )}
      <PaginationLinks basePath="/inbox" page={page} totalRows={counts[view]} query={{ view }} />
    </>
  );
}
