import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageLoading } from "@/components/page-loading";
import { PaginationLinks } from "@/components/pagination-links";
import { RefreshEvery } from "@/components/refresh-every";
import { getCommentsFromCore } from "@/lib/core-views/comments";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { CommentList } from "./comment-list";

export const metadata: Metadata = { title: "Comments - ansa" };

// Inbox → Comments: what people wrote under the business's Facebook Page
// posts, newest first, and what ansa did with each (answered under it, wrote
// to them in Messenger, passed it to you, or left it and why). A reply that
// waits for a person ("Ask me first") is sent or discarded here.
export default function CommentsPage({ searchParams }: PageProps<"/inbox/comments">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session and ?page= are only known at
          request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<PageLoading />}>
        <CommentsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function CommentsContent({ searchParams }: Pick<PageProps<"/inbox/comments">, "searchParams">) {
  const page = parsePageNumber((await searchParams).page);
  await requireSessionContext("/inbox/comments");
  const { comments, total, commentsOn } = await getCommentsFromCore(page);
  return (
    <>
      <div className="grid gap-1">
        <Link href="/inbox" className="text-sm text-muted-foreground hover:underline">
          &larr; Inbox
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Comments</h1>
        <p className="text-sm text-muted-foreground">
          Comments on your Facebook Page&apos;s posts, newest first, and what ansa did with each. When someone answers ansa&apos;s
          private message, the chat goes on in your Inbox.
        </p>
      </div>
      {/* New comments and ansa's answers show up by themselves. */}
      <RefreshEvery seconds={5} />
      {!commentsOn && (
        <p className="rounded-2xl border border-dashed px-5 py-4 text-sm">
          ansa doesn&apos;t answer comments right now. Switch it on in{" "}
          <Link href="/settings/channels#comments-heading" className="text-link hover:underline">
            Settings → Connections
          </Link>
          , under Facebook Page.
        </p>
      )}
      {comments.length > 0 ? (
        <CommentList comments={comments} />
      ) : page > 1 ? (
        <EmptyState>
          Nothing on this page.{" "}
          <Link href="/inbox/comments" className="underline">
            Go to the first page
          </Link>
        </EmptyState>
      ) : (
        <EmptyState>No comments yet. Comments on your Facebook Page&apos;s posts show here as they arrive.</EmptyState>
      )}
      <PaginationLinks basePath="/inbox/comments" page={page} totalRows={total} />
    </>
  );
}
