import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KNOWLEDGE_KIND_LABELS, KNOWLEDGE_STATUS_LABELS, type KnowledgeStatus } from "@/lib/knowledge/kinds";
import type { KnowledgeArticleListItem } from "@/services/knowledge";

const STATUS_BADGES: Record<KnowledgeStatus, "default" | "secondary" | "outline"> = {
  approved: "default",
  draft: "secondary",
  archived: "outline",
};

// WHY a fixed layout: the table is exactly as wide as the page, whatever the
// titles say; a long title is cut with "..." (whole on hover and on its
// page). Narrow screens keep Title and Status.
export function ArticleTable({ articles }: { articles: KnowledgeArticleListItem[] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead className="w-24">Status</TableHead>
          <TableHead className="hidden w-40 md:table-cell">Kind</TableHead>
          <TableHead className="hidden w-36 lg:table-cell">Used for</TableHead>
          <TableHead className="hidden w-48 lg:table-cell">Last changed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {articles.map((article) => (
          <ArticleRow key={article.id} article={article} />
        ))}
      </TableBody>
    </Table>
  );
}

function ArticleRow({ article }: { article: KnowledgeArticleListItem }) {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/knowledge/${article.id}`} title={article.title} className="block truncate font-medium hover:underline">
          {article.title}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGES[article.status]}>{KNOWLEDGE_STATUS_LABELS[article.status]}</Badge>
      </TableCell>
      <TableCell className="hidden truncate md:table-cell">{KNOWLEDGE_KIND_LABELS[article.kind]}</TableCell>
      <TableCell className="hidden truncate lg:table-cell">{describeAudiences(article)}</TableCell>
      <TableCell className="hidden truncate lg:table-cell" title={article.updatedByName ?? undefined}>
        <LocalDateTime iso={article.updatedAt.toISOString()} dateOnly />
        {article.updatedByName && <span className="text-muted-foreground"> by {article.updatedByName}</span>}
      </TableCell>
    </TableRow>
  );
}

// "Support", "Support, marketing", or "Nobody" when both are off.
export function describeAudiences(article: { useForSupport: boolean; useForMarketing: boolean }): string {
  const audiences = [article.useForSupport && "Support", article.useForMarketing && "Marketing"].filter(Boolean);
  return audiences.length > 0 ? audiences.join(", ") : "Nobody";
}
