import { Suspense } from "react";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { MAX_CALL_LOOKUPS_SHOWN } from "@/lib/knowledge/limits";
import type { SessionContext } from "@/lib/session";
import { listKnowledgeLookupsForCallForSession, type CallKnowledgeLookup } from "@/services/knowledge-lookups";

type KnowledgeLookupsProps = {
  session: SessionContext;
  callId: string;
};

// "Knowledge the AI looked up during the call" (step 35): each search the
// voice assistant made, and the articles its answer held. What the caller
// asked is never kept, so it can't be shown. The lookups have their own
// <Suspense>, so the rest of the page never waits for them.
export function KnowledgeLookups({ session, callId }: KnowledgeLookupsProps) {
  return (
    <section className="grid min-w-0 gap-2 wrap-anywhere">
      <h2 className="text-lg font-semibold">Knowledge the AI looked up during the call</h2>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading what the AI looked up...</p>}>
        <LookupList session={session} callId={callId} />
      </Suspense>
    </section>
  );
}

async function LookupList({ session, callId }: KnowledgeLookupsProps) {
  const { lookups, moreNotShown } = await listKnowledgeLookupsForCallForSession(session, callId);
  if (lookups.length === 0) {
    return <p className="text-sm text-muted-foreground">The AI didn&apos;t search the knowledge base during this call.</p>;
  }
  return (
    <>
      <ul className="grid gap-1 text-sm">
        {lookups.map((lookup) => (
          <li key={lookup.id}>
            <span className="text-muted-foreground">
              <LocalDateTime iso={lookup.at.toISOString()} />:
            </span>{" "}
            <LookupArticles articles={lookup.articles} />
          </li>
        ))}
      </ul>
      {moreNotShown && (
        <p className="text-sm text-muted-foreground">Only the first {MAX_CALL_LOOKUPS_SHOWN} lookups of this call are shown.</p>
      )}
    </>
  );
}

// The articles one answer held, best first, each linking to its page.
function LookupArticles({ articles }: Pick<CallKnowledgeLookup, "articles">) {
  if (articles.length === 0) {
    return <span className="text-muted-foreground">nothing found</span>;
  }
  return articles.map((article, index) => (
    <span key={article.articleId}>
      {index > 0 && ", "}
      {article.title === null ? (
        <span className="text-muted-foreground">deleted article</span>
      ) : (
        <Link href={`/knowledge/${article.articleId}`} className="font-medium underline">
          {article.title}
        </Link>
      )}
    </span>
  ));
}
