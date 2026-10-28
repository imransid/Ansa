import "server-only";
import { z } from "zod";
import {
  countKnowledgeArticlesPerStatus,
  getKnowledgeArticleForCompany,
  getKnowledgeArticlesForCompany,
  type KnowledgeArticleDetail,
  type KnowledgeArticleListItem,
  type KnowledgeStatusCounts,
} from "@/db/knowledge-articles";
import { countArticleChunks } from "@/db/knowledge-chunks";
import { createKnowledgeArticles, editKnowledgeArticle, type NewArticleSource } from "@/db/knowledge-writes";
import { getTicketByNumber } from "@/db/tickets";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { MAX_KNOWLEDGE_ARTICLES_PER_COMPANY } from "@/lib/knowledge/limits";
import type { SessionContext } from "@/lib/session";
import { editKnowledgeArticleSchema, knowledgeArticleIdSchema, knowledgeArticleSchema } from "@/lib/validation/knowledge";
import type { KnowledgeListQuery } from "@/lib/validation/list-queries";
import { ticketNumberSchema } from "@/lib/validation/tickets";
import { describeKnowledgeOutcome } from "./knowledge-messages";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The company's knowledge base (step 34): listing, reading, writing and
// editing articles. Anyone in the company writes and edits drafts; approving,
// archiving, restoring and deleting are in services/knowledge-status.ts,
// imports in services/knowledge-import.ts, the search in
// services/knowledge-search.ts.

// Re-exported so pages can use the types without importing from /db.
export type { KnowledgeArticleListItem, KnowledgeStatusCounts };

export type KnowledgeArticlePage = KnowledgeArticleDetail & {
  // How many pieces the search reads (lib/knowledge/chunking.ts).
  chunkCount: number;
};

// What "New article" gives back to its form: the new article, or why not.
export type CreatedArticleResult = { ok: true; articleId: string } | { ok: false; errors: FormErrors };

// The solved ticket "Save as knowledge" came from, to fill in the form.
export type TicketForArticle = { ticketNumber: number; subject: string };

const EVERY_ARTICLE: KnowledgeListQuery = { status: "all", search: null };

// Lists one page of the session company's articles, last changed first.
export async function listKnowledgeArticlesForSession(
  session: SessionContext,
  page = 1,
  query: KnowledgeListQuery = EVERY_ARTICLE,
): Promise<KnowledgeArticleListItem[]> {
  return getKnowledgeArticlesForCompany(session.companyId, { status: query.status, search: query.search }, page);
}

// Counts the session company's articles by status, with the list's search.
export async function countKnowledgeArticlesForSession(session: SessionContext, search: string | null = null): Promise<KnowledgeStatusCounts> {
  return countKnowledgeArticlesPerStatus(session.companyId, search);
}

// Reads one article of the session's company by the id in the URL. Null for
// a malformed id and for an article that is not this company's.
export async function getKnowledgeArticleForSession(session: SessionContext, articleId: unknown): Promise<KnowledgeArticlePage | null> {
  const parsed = knowledgeArticleIdSchema.safeParse({ articleId });
  if (!parsed.success) {
    return null;
  }
  const [article, chunkCount] = await Promise.all([
    getKnowledgeArticleForCompany(session.companyId, parsed.data.articleId),
    countArticleChunks(session.companyId, parsed.data.articleId),
  ]);
  return article ? { ...article, chunkCount } : null;
}

// The session company's solved ticket with this number (from the URL of
// "Save as knowledge"), or null: another company's number, an open ticket or
// no number at all gives a plain article.
export async function getSolvedTicketForArticleForSession(session: SessionContext, fromTicket: unknown): Promise<TicketForArticle | null> {
  const ticketNumber = ticketNumberSchema.safeParse(fromTicket);
  if (!ticketNumber.success) {
    return null;
  }
  const ticket = await getTicketByNumber(session.companyId, ticketNumber.data);
  return ticket?.status === "solved" ? { ticketNumber: ticket.ticketNumber, subject: ticket.subject } : null;
}

// Saves a new draft article written by the logged-in user for their company.
// fromTicket (the number in "Save as knowledge"'s URL) becomes its source
// only when it is a solved ticket of this company, checked in the same
// transaction. Anyone in the company may do this.
export async function createKnowledgeArticleForSession(session: SessionContext, input: Record<string, unknown>): Promise<CreatedArticleResult> {
  const parsed = knowledgeArticleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("knowledge-writes", session.userId, RATE_LIMITS.knowledgeWritesPerUser)) {
    return tooManyChanges();
  }
  const ticketNumber = ticketNumberSchema.safeParse(input.fromTicket);
  const source: NewArticleSource = ticketNumber.success ? { type: "ticket", ticketNumber: ticketNumber.data } : { type: "none" };
  const created = await createKnowledgeArticles(session.companyId, session.userId, [parsed.data], source);
  if (created.outcome === "created") {
    return { ok: true, articleId: created.articleIds[0] };
  }
  if (created.outcome === "full") {
    return { ok: false, errors: { message: companyFullMessage() } };
  }
  return { ok: false, errors: { message: "You can't add articles to this company." } };
}

// Saves the logged-in user's edit of one of their company's articles: a
// draft (anyone), or an approved one (owners only; it stays approved).
// Refused when someone changed the article after it was opened.
export async function editKnowledgeArticleForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = editKnowledgeArticleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("knowledge-writes", session.userId, RATE_LIMITS.knowledgeWritesPerUser)) {
    return tooManyChanges();
  }
  const { articleId, revision, ...fields } = parsed.data;
  const outcome = await editKnowledgeArticle(session.companyId, session.userId, { articleId, revision, fields });
  return describeKnowledgeOutcome(outcome, "edit");
}

// What a write says when the company has as many articles as it may keep.
export function companyFullMessage(): string {
  return `Your company has reached its limit of ${MAX_KNOWLEDGE_ARTICLES_PER_COMPANY.toLocaleString("en-US")} articles. Delete ones you no longer need to make room.`;
}

// What a write says when the person passed the knowledge-writes limit.
export function tooManyChanges(): FormResult & { ok: false } {
  return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
}
