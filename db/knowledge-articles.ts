import "server-only";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { KnowledgeKind, KnowledgeStatus } from "@/lib/knowledge/kinds";
import { PAGE_SIZE, pageOffset } from "@/lib/pagination";
import { containsPattern } from "@/lib/search-patterns";
import type { KnowledgeListQuery, KnowledgeStatusFilter } from "@/lib/validation/list-queries";
import { db } from "./client";
import { companyDocuments, knowledgeArticles, tickets, users } from "./schema";

// Reading one company's knowledge articles (step 34): the Knowledge page's
// list and counts, and one article with where it came from and who wrote and
// approved it. Writes are in db/knowledge-writes.ts, the search in
// db/knowledge-search.ts.

// Which articles to list: a status and a title search from the URL.
export type KnowledgeListFilter = KnowledgeListQuery;

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

// Views of the users table: who wrote it, who changed it last, who approved
// it. Every join also matches company_id, so a name from another company can
// never show up (the foreign keys already prevent that link).
const creator = alias(users, "creator");
const updater = alias(users, "updater");
const approver = alias(users, "approver");

// Lists one page of one company's articles, last changed first.
export async function getKnowledgeArticlesForCompany(
  companyId: string,
  filter: KnowledgeListFilter,
  page: number,
): Promise<KnowledgeArticleListItem[]> {
  return db
    .select({
      id: knowledgeArticles.id,
      title: knowledgeArticles.title,
      kind: knowledgeArticles.kind,
      status: knowledgeArticles.status,
      useForSupport: knowledgeArticles.useForSupport,
      useForMarketing: knowledgeArticles.useForMarketing,
      updatedAt: knowledgeArticles.updatedAt,
      updatedByName: updater.name,
    })
    .from(knowledgeArticles)
    .leftJoin(updater, and(eq(updater.id, knowledgeArticles.updatedByUserId), eq(updater.companyId, knowledgeArticles.companyId)))
    .where(knowledgeListWhere(companyId, filter))
    .orderBy(desc(knowledgeArticles.updatedAt), desc(knowledgeArticles.id))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
}

// Counts one company's articles by status, with the list's title search:
// the numbers on the status links and "Page 2 of 5".
export async function countKnowledgeArticlesPerStatus(companyId: string, search: string | null): Promise<KnowledgeStatusCounts> {
  const [counts] = await db
    .select({
      all: countWhere(undefined),
      draft: countWhere(eq(knowledgeArticles.status, "draft")),
      approved: countWhere(eq(knowledgeArticles.status, "approved")),
      archived: countWhere(eq(knowledgeArticles.status, "archived")),
    })
    .from(knowledgeArticles)
    .where(knowledgeListWhere(companyId, { status: "all", search }));
  return counts ?? { all: 0, draft: 0, approved: 0, archived: 0 };
}

// Reads one article of one company, or undefined (unknown, or another company's).
export async function getKnowledgeArticleForCompany(companyId: string, articleId: string): Promise<KnowledgeArticleDetail | undefined> {
  const [article] = await db
    .select({
      id: knowledgeArticles.id,
      title: knowledgeArticles.title,
      body: knowledgeArticles.body,
      kind: knowledgeArticles.kind,
      status: knowledgeArticles.status,
      useForSupport: knowledgeArticles.useForSupport,
      useForMarketing: knowledgeArticles.useForMarketing,
      revision: knowledgeArticles.revision,
      sourceUrl: knowledgeArticles.sourceUrl,
      sourceDocumentName: companyDocuments.fileName,
      sourceTicketNumber: tickets.ticketNumber,
      createdAt: knowledgeArticles.createdAt,
      createdByName: creator.name,
      updatedAt: knowledgeArticles.updatedAt,
      updatedByName: updater.name,
      approvedAt: knowledgeArticles.approvedAt,
      approvedByName: approver.name,
    })
    .from(knowledgeArticles)
    .leftJoin(
      companyDocuments,
      and(eq(companyDocuments.id, knowledgeArticles.sourceDocumentId), eq(companyDocuments.companyId, knowledgeArticles.companyId)),
    )
    .leftJoin(tickets, and(eq(tickets.id, knowledgeArticles.sourceTicketId), eq(tickets.companyId, knowledgeArticles.companyId)))
    .leftJoin(creator, and(eq(creator.id, knowledgeArticles.createdByUserId), eq(creator.companyId, knowledgeArticles.companyId)))
    .leftJoin(updater, and(eq(updater.id, knowledgeArticles.updatedByUserId), eq(updater.companyId, knowledgeArticles.companyId)))
    .leftJoin(approver, and(eq(approver.id, knowledgeArticles.approvedByUserId), eq(approver.companyId, knowledgeArticles.companyId)))
    .where(and(eq(knowledgeArticles.companyId, companyId), eq(knowledgeArticles.id, articleId)));
  return article;
}

// One company's approved articles meant for support or marketing, by title,
// at most `limit`: the ones an owner may pick for "Suggest facts from
// knowledge" (step 36). One ticked for neither is for nobody, as its page
// says, so no AI reads it.
export async function getApprovedKnowledgeArticleTitles(companyId: string, limit: number): Promise<{ id: string; title: string }[]> {
  return db
    .select({ id: knowledgeArticles.id, title: knowledgeArticles.title })
    .from(knowledgeArticles)
    .where(
      and(
        eq(knowledgeArticles.companyId, companyId),
        eq(knowledgeArticles.status, "approved"),
        or(eq(knowledgeArticles.useForSupport, true), eq(knowledgeArticles.useForMarketing, true)),
      ),
    )
    .orderBy(knowledgeArticles.title, knowledgeArticles.id)
    .limit(limit);
}

// The WHERE of the list and its counts: ALWAYS the company first, then the
// status and the title search (ILIKE, with %, _ and \ escaped; a parameter).
function knowledgeListWhere(companyId: string, filter: KnowledgeListFilter): SQL | undefined {
  return and(
    eq(knowledgeArticles.companyId, companyId),
    filter.status === "all" ? undefined : eq(knowledgeArticles.status, filter.status),
    filter.search ? ilike(knowledgeArticles.title, containsPattern(filter.search)) : undefined,
  );
}

// Counts only the rows that match, in the same pass over the table as the
// other counts. No condition counts every row.
function countWhere(condition: SQL | undefined) {
  return sql<number>`count(*) filter (where ${condition ?? sql`true`})`.mapWith(Number);
}
