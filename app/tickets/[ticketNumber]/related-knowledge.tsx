import { Suspense } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { KNOWLEDGE_KIND_LABELS } from "@/lib/knowledge/kinds";
import type { SessionContext } from "@/lib/session";
import { listRelatedKnowledgeForTicketForSession } from "@/services/knowledge-search";

type KnowledgeSectionProps = {
  session: SessionContext;
  ticketNumber: number;
  subject: string;
  category: string | null;
  isSolved: boolean;
};

// "Related knowledge" (step 34): the company's approved support articles
// that match the ticket's subject and category, for the teammate working on
// it. On a solved ticket, "Save as knowledge" writes its fix down for next
// time. The search has its own <Suspense>, so the rest of the page never
// waits for it.
export function KnowledgeSection({ session, ticketNumber, subject, category, isSolved }: KnowledgeSectionProps) {
  return (
    <section className="grid min-w-0 gap-2 wrap-anywhere">
      <h2 className="text-lg font-semibold">Related knowledge</h2>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Looking for related articles...</p>}>
        <RelatedArticles session={session} subject={subject} category={category} />
      </Suspense>
      {isSolved && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/knowledge/new?fromTicket=${ticketNumber}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            Save as knowledge
          </Link>
          <span className="text-muted-foreground">Write the fix down in general terms, so the next customer gets it faster.</span>
        </div>
      )}
    </section>
  );
}

async function RelatedArticles({ session, subject, category }: Omit<KnowledgeSectionProps, "ticketNumber" | "isSolved">) {
  const articles = await listRelatedKnowledgeForTicketForSession(session, { subject, category });
  if (articles.length === 0) {
    return <p className="text-sm text-muted-foreground">No approved article matches this ticket.</p>;
  }
  return (
    <ul className="grid gap-2 text-sm">
      {articles.map((article) => (
        <li key={article.articleId} className="grid gap-1">
          <p>
            <Link href={`/knowledge/${article.articleId}`} className="font-medium underline">
              {article.title}
            </Link>
            <span className="text-muted-foreground"> · {KNOWLEDGE_KIND_LABELS[article.kind]}</span>
          </p>
          <p className="line-clamp-3 whitespace-pre-line text-muted-foreground">{article.text}</p>
        </li>
      ))}
    </ul>
  );
}
