import type { KnowledgeKind, KnowledgeStatus } from "@/lib/knowledge/kinds";
import type { KnowledgeStatusFilter } from "@/lib/validation/list-queries";

// The company's knowledge articles (step 34) as the Knowledge list and an
// article's page read them.

export type KnowledgeArticleListItem = {
  id: string;
  title: string;
  kind: KnowledgeKind;
  status: KnowledgeStatus;
  useForSupport: boolean;
  useForMarketing: boolean;
  updatedAt: Date;
  updatedByName: string | null;
};

export type KnowledgeStatusCounts = Record<KnowledgeStatusFilter, number>;

export type KnowledgeArticleDetail = Omit<KnowledgeArticleListItem, "updatedByName"> & {
  body: string;
  revision: number;
  sourceUrl: string | null;
  // The document's name and the ticket's number, when the article came from
  // one that still exists in this company.
  sourceDocumentName: string | null;
  sourceTicketNumber: number | null;
  createdAt: Date;
  createdByName: string | null;
  updatedByName: string | null;
  approvedAt: Date | null;
  approvedByName: string | null;
};
