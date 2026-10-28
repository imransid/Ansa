import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { KNOWLEDGE_KIND_LABELS, KNOWLEDGE_STATUS_LABELS } from "@/lib/knowledge/kinds";
import type { KnowledgeArticlePage } from "@/services/knowledge";
import { describeAudiences } from "../article-table";

// The top of an article's page: its title, status and what that means for
// the AI, where it came from, who wrote, changed and approved it, and how
// many pieces the search reads.
export function ArticleSummary({ article }: { article: KnowledgeArticlePage }) {
  return (
    <section className="grid min-w-0 gap-3 wrap-anywhere">
      <h1 className="text-xl font-semibold">{article.title}</h1>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={article.status === "approved" ? "default" : "secondary"}>{KNOWLEDGE_STATUS_LABELS[article.status]}</Badge>
        <span>{KNOWLEDGE_KIND_LABELS[article.kind]}</span>
        <span className="text-muted-foreground">· Used for: {describeAudiences(article)}</span>
      </div>
      <p className="text-sm">{describeStatus(article)}</p>
      <dl className="grid gap-1 text-sm text-muted-foreground">
        <SourceLine article={article} />
        <div>
          <dt className="inline">Written by </dt>
          <dd className="inline">
            {article.createdByName ?? "a former teammate"}, <LocalDateTime iso={article.createdAt.toISOString()} />
          </dd>
        </div>
        <div>
          <dt className="inline">Last changed by </dt>
          <dd className="inline">
            {article.updatedByName ?? "a former teammate"}, <LocalDateTime iso={article.updatedAt.toISOString()} />
          </dd>
        </div>
        {article.approvedAt && (
          <div>
            <dt className="inline">{article.status === "approved" ? "Approved by " : "Last approved by "}</dt>
            <dd className="inline">
              {article.approvedByName ?? "a former teammate"}, <LocalDateTime iso={article.approvedAt.toISOString()} />
            </dd>
          </div>
        )}
        <div>
          <dt className="inline">Search reads it as </dt>
          <dd className="inline">{article.chunkCount === 1 ? "1 piece" : `${article.chunkCount} pieces`} of whole paragraphs</dd>
        </div>
      </dl>
    </section>
  );
}

function describeStatus(article: KnowledgeArticlePage): string {
  if (article.status === "draft") {
    return "Draft: not shown on tickets or given to any AI until an owner approves it.";
  }
  if (article.status === "archived") {
    return "Archived: nobody uses it. An owner can restore it as a draft.";
  }
  if (!article.useForSupport && !article.useForMarketing) {
    return "Approved, but ticked for neither support nor marketing, so nothing uses it.";
  }
  return `Approved: used for ${describeAudiences(article).toLowerCase()}.`;
}

// Where the article came from, if anywhere. A deleted document is no longer
// named (deleting it clears the link, db/documents.ts).
function SourceLine({ article }: { article: KnowledgeArticlePage }) {
  if (article.sourceTicketNumber !== null) {
    return (
      <div>
        <dt className="inline">From </dt>
        <dd className="inline">
          <Link href={`/tickets/${article.sourceTicketNumber}`} className="underline">
            ticket #{article.sourceTicketNumber}
          </Link>
        </dd>
      </div>
    );
  }
  if (article.sourceDocumentName !== null) {
    return (
      <div>
        <dt className="inline">From the document </dt>
        <dd className="inline">
          <Link href="/setup#documents" className="underline">
            {article.sourceDocumentName}
          </Link>
        </dd>
      </div>
    );
  }
  if (article.sourceUrl !== null) {
    return (
      <div>
        <dt className="inline">From the web page </dt>
        <dd className="inline">
          {/* Someone else's site: it learns nothing about this page (noreferrer). */}
          <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
            {article.sourceUrl}
          </a>
        </dd>
      </div>
    );
  }
  return null;
}
