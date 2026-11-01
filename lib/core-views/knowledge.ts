import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { knowledgeArticleIdSchema } from "@/lib/validation/knowledge";
import type { KnowledgeListQuery } from "@/lib/validation/list-queries";
import { ticketNumberSchema } from "@/lib/validation/tickets";
import type { ImportResult } from "@/services/knowledge-import";
import type { KnowledgeArticleListItem, KnowledgeArticlePage, KnowledgeStatusCounts, TicketForArticle } from "@/services/knowledge";
import type { KnowledgeTestResult } from "@/services/knowledge-search";

// The Knowledge pages through the new backend (core's /api/v1/knowledge),
// in the shapes the pages and their actions already read.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// An article's address in core.
function articlePath(articleId: unknown): string {
  return `/api/v1/knowledge/articles/${encodeURIComponent(text(articleId))}`;
}

// The revision the page showed, as a number (0 when the form held none).
function revisionNumber(value: unknown): number {
  const revision = Number.parseInt(text(value), 10);
  return Number.isFinite(revision) ? revision : 0;
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Dates come as ISO text.
type CoreLine = Omit<KnowledgeArticleListItem, "updatedAt"> & { updatedAt: string };

type CoreArticle = Omit<KnowledgeArticlePage, "updatedAt" | "createdAt" | "approvedAt" | "chunkCount"> & {
  updatedAt: string;
  createdAt: string;
  approvedAt: string | null;
  pieces: number;
};

// One page of the list (50, last changed first), the counts per status with
// the same title search, and whether this person manages knowledge.
export async function getKnowledgeListFromCore(
  page: number,
  query: KnowledgeListQuery,
): Promise<{ articles: KnowledgeArticleListItem[]; counts: KnowledgeStatusCounts; isOwner: boolean }> {
  const address = new URLSearchParams({ status: query.status, q: query.search ?? "", page: String(page) });
  const answer = await callCore<{ articles: CoreLine[]; counts: KnowledgeStatusCounts; canManage: boolean }>("GET", `/api/v1/knowledge?${address.toString()}`);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return {
    articles: answer.data.articles.map((article) => ({ ...article, updatedAt: new Date(article.updatedAt) })),
    counts: answer.data.counts,
    isOwner: answer.data.canManage,
  };
}

// One article of the company and what this person may do with it; null for
// an unknown id or another company's article.
export async function getKnowledgeArticleFromCore(articleId: string): Promise<{ article: KnowledgeArticlePage; canEdit: boolean; isOwner: boolean } | null> {
  // An id from the address: anything but a uuid is no article (and never a path of its own).
  if (!knowledgeArticleIdSchema.safeParse({ articleId }).success) {
    return null;
  }
  const answer = await callCore<{ article: CoreArticle; canEdit: boolean; canManage: boolean }>("GET", articlePath(articleId));
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { pieces, updatedAt, createdAt, approvedAt, ...rest } = answer.data.article;
  return {
    article: {
      ...rest,
      updatedAt: new Date(updatedAt),
      createdAt: new Date(createdAt),
      approvedAt: approvedAt ? new Date(approvedAt) : null,
      chunkCount: pieces,
    },
    canEdit: answer.data.canEdit,
    isOwner: answer.data.canManage,
  };
}

// "Save as knowledge": the company's SOLVED request with the number in the
// address, or null (no number, another company's, or still open).
export async function getSolvedTicketForArticleFromCore(fromTicket: unknown): Promise<TicketForArticle | null> {
  const ticketNumber = ticketNumberSchema.safeParse(fromTicket);
  if (!ticketNumber.success) {
    return null;
  }
  const answer = await callCore<{ request: { number: number; subject: string; status: string } }>("GET", `/api/v1/requests/${ticketNumber.data}`);
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { request } = answer.data;
  return request.status === "solved" ? { ticketNumber: request.number, subject: request.subject } : null;
}

// The fields of the article form: a ticked box sends "on".
type ArticleForm = { title: unknown; kind: unknown; body: unknown; useForSupport: unknown; useForMarketing: unknown };

function articleFields(form: ArticleForm) {
  return {
    title: text(form.title),
    kind: text(form.kind),
    body: text(form.body),
    useForSupport: form.useForSupport === "on",
    useForMarketing: form.useForMarketing === "on",
  };
}

// A new draft; fromTicket (a solved request's number) becomes its source
// only when core finds it solved in the company.
export async function createArticleThroughCore(form: ArticleForm & { fromTicket: unknown }): Promise<{ ok: true; articleId: string } | { ok: false; errors: FormErrors }> {
  const ticketNumber = ticketNumberSchema.safeParse(form.fromTicket);
  const answer = await callCore<{ id: string }>("POST", "/api/v1/knowledge/articles", {
    ...articleFields(form),
    ...(ticketNumber.success ? { fromTicket: ticketNumber.data } : {}),
  });
  return answer.ok ? { ok: true, articleId: answer.data.id } : { ok: false, errors: toFormErrors(answer) };
}

// An edit of the article as the page showed it (its revision).
export async function editArticleThroughCore(form: ArticleForm & { articleId: unknown; revision: unknown }): Promise<FormResult> {
  const answer = await callCore("POST", `${articlePath(form.articleId)}/edit`, { ...articleFields(form), revision: revisionNumber(form.revision) });
  return savedOrErrors(answer);
}

// change: "approve" (the revision the owner read), "archive" or "restore".
export async function changeArticleStatusThroughCore(articleId: unknown, change: "approve" | "archive" | "restore", revision?: unknown): Promise<FormResult> {
  const answer = await callCore("POST", `${articlePath(articleId)}/status`, { change, revision: revisionNumber(revision) });
  return savedOrErrors(answer);
}

export async function deleteArticleThroughCore(articleId: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `${articlePath(articleId)}/delete`));
}

function importOutcome(answer: CoreAnswer<{ created: number; wasCut: boolean }>): ImportResult {
  return answer.ok ? { ok: true, createdCount: answer.data.created, wasCut: answer.data.wasCut } : { ok: false, errors: toFormErrors(answer) };
}

// "Add to knowledge" on a Setup document: its text becomes drafts.
export async function importDocumentThroughCore(documentId: unknown): Promise<ImportResult> {
  return importOutcome(await callCore("POST", "/api/v1/knowledge/import/document", { documentId: text(documentId) }));
}

// "Import a web page": one public page's text becomes drafts.
export async function importWebPageThroughCore(url: unknown): Promise<ImportResult> {
  return importOutcome(await callCore("POST", "/api/v1/knowledge/import/web", { url: text(url) }));
}

// "Test what the AI finds": exactly what ansa's chat assistant reads for
// this question (its best 3 pieces within 3,000 characters), and the one
// line the phone assistant hears. Nothing is saved or sent to any AI.
export async function testKnowledgeThroughCore(question: unknown): Promise<KnowledgeTestResult> {
  const answer = await callCore<{ slice: { hits: { title: string; text: string }[]; text: string }; callAnswer: string }>("POST", "/api/v1/knowledge/test", {
    question: text(question),
  });
  return answer.ok ? { ok: true, slice: answer.data.slice, callAnswer: answer.data.callAnswer } : { ok: false, errors: toFormErrors(answer) };
}
