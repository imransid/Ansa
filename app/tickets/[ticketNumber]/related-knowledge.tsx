import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { KNOWLEDGE_KIND_LABELS } from "@/lib/knowledge/kinds";
import type { RelatedArticle } from "@/lib/types/knowledge-search";

type KnowledgeSectionProps = {
  ticketNumber: number;
  isSolved: boolean;
  // Found by core with the request (its subject and category).
  articles: RelatedArticle[];
};

// "Related knowledge" (step 34): the company's approved support articles
// that match the ticket's subject and category, for the teammate working on
// it. On a solved ticket, "Save as knowledge" writes its fix down for next
// time.
export function KnowledgeSection({ ticketNumber, isSolved, articles }: KnowledgeSectionProps) {
  return (
    <section className="grid min-w-0 gap-2 wrap-anywhere">
      <h2 className="text-lg font-semibold">Related knowledge</h2>
      <RelatedArticles articles={articles} />
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

// The list alone, also under a conversation's open request (its box has its own heading).
export function RelatedArticles({ articles }: Pick<KnowledgeSectionProps, "articles">) {
  if (articles.length === 0) {
    return <p className="text-sm text-muted-foreground">No approved article matches this request.</p>;
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
