"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTypedValues, type FormErrors, type FormResult, type SaveState } from "@/lib/form-result";
import type { KnowledgeSlice } from "@/lib/knowledge/prompt-slice";
import { requireSessionContext } from "@/lib/session";
import { createKnowledgeArticleForSession, editKnowledgeArticleForSession } from "@/services/knowledge";
import { importDocumentToKnowledgeForSession, type ImportResult } from "@/services/knowledge-import";
import { testKnowledgeSearchForSession } from "@/services/knowledge-search";
import {
  approveKnowledgeArticleForSession,
  archiveKnowledgeArticleForSession,
  deleteKnowledgeArticleForSession,
  restoreKnowledgeArticleForSession,
} from "@/services/knowledge-status";
import { importWebPageToKnowledgeForSession } from "@/services/knowledge-web-import";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which checks company, role, input and rate limits),
// refresh the pages that show knowledge.

// What "Test what the AI finds" shows: the hits and the phone assistant's
// one line for them, or why there are none.
export type KnowledgeTestState = { slice?: KnowledgeSlice; callAnswer?: string; errors?: FormErrors; question?: string };

// What an import's button or form shows after it ran.
export type ImportState = { result?: ImportResult; values?: Record<string, string> };

// "New article": on success, opens the new article.
export async function createKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await createKnowledgeArticleForSession(session, {
    ...articleFields(formData),
    fromTicket: formData.get("fromTicket"),
  });
  if (!result.ok) {
    return result.errors;
  }
  refreshKnowledgePages();
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/knowledge/${result.articleId}`);
}

export async function editKnowledgeArticleAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  const session = await requireSessionContext();
  const result = await editKnowledgeArticleForSession(session, {
    ...articleFields(formData),
    articleId: formData.get("articleId"),
    revision: formData.get("revision"),
  });
  if (!result.ok) {
    return { errors: result.errors };
  }
  refreshKnowledgePages();
  return { saved: true };
}

export async function approveKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  const input = { articleId: formData.get("articleId"), revision: formData.get("revision") };
  return refreshOrReturnErrors(await approveKnowledgeArticleForSession(session, input));
}

export async function archiveKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await archiveKnowledgeArticleForSession(session, { articleId: formData.get("articleId") }));
}

export async function restoreKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  return refreshOrReturnErrors(await restoreKnowledgeArticleForSession(session, { articleId: formData.get("articleId") }));
}

// On success the article is gone, so its page leads back to the list.
export async function deleteKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  const result = await deleteKnowledgeArticleForSession(session, { articleId: formData.get("articleId") });
  if (!result.ok) {
    return result.errors;
  }
  refreshKnowledgePages();
  redirect("/knowledge");
}

// Nothing is saved: the question is only searched for, and sent back so the
// box shows it again.
export async function testKnowledgeSearchAction(_previous: KnowledgeTestState | undefined, formData: FormData): Promise<KnowledgeTestState> {
  const session = await requireSessionContext();
  const question = String(formData.get("question") ?? "").slice(0, 1000);
  const result = await testKnowledgeSearchForSession(session, { question: formData.get("question") });
  return result.ok ? { slice: result.slice, callAnswer: result.callAnswer, question } : { errors: result.errors, question };
}

export async function importDocumentToKnowledgeAction(_previous: ImportState | undefined, formData: FormData): Promise<ImportState> {
  const session = await requireSessionContext();
  const result = await importDocumentToKnowledgeForSession(session, { documentId: formData.get("documentId") });
  if (result.ok) {
    refreshKnowledgePages();
  }
  return { result };
}

export async function importWebPageAction(_previous: ImportState | undefined, formData: FormData): Promise<ImportState> {
  const session = await requireSessionContext();
  const result = await importWebPageToKnowledgeForSession(session, { url: formData.get("url") });
  if (result.ok) {
    refreshKnowledgePages();
    return { result };
  }
  return { result, values: withTypedValues(result.errors, formData, ["url"]).values };
}

// The fields of the article form, read one by one.
function articleFields(formData: FormData) {
  return {
    title: formData.get("title"),
    kind: formData.get("kind"),
    body: formData.get("body"),
    useForSupport: formData.get("useForSupport"),
    useForMarketing: formData.get("useForMarketing"),
  };
}

function refreshOrReturnErrors(result: FormResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  refreshKnowledgePages();
  return undefined;
}

// The list, every article's page, and the ticket pages (their "Related
// knowledge" shows approved articles).
function refreshKnowledgePages(): void {
  revalidatePath("/knowledge");
  revalidatePath("/knowledge/[articleId]", "page");
  revalidatePath("/tickets/[ticketNumber]", "page");
}
