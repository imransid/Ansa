"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeArticleStatusThroughCore,
  createArticleThroughCore,
  deleteArticleThroughCore,
  editArticleThroughCore,
  importDocumentThroughCore,
  importWebPageThroughCore,
  testKnowledgeThroughCore,
} from "@/lib/core-views/knowledge";
import { withTypedValues, type FormErrors, type FormResult, type SaveState } from "@/lib/form-result";
import type { KnowledgeSlice } from "@/lib/knowledge/prompt-slice";
import { requireSessionContext } from "@/lib/session";
import type { ImportResult } from "@/lib/types/knowledge-import";

// Server actions are public POST endpoints. Keep them thin: read the form,
// ask core (which checks company, role, input and rate limits),
// refresh the pages that show knowledge. Each uses the new backend when it
// is switched on (lib/core-api.ts), else services/.

// What "Test what the AI finds" shows: the hits and the phone assistant's
// one line for them, or why there are none. readByChatAssistant: the new
// backend answered, so the hits are exactly what ansa's chat assistant
// reads (its best 3 pieces within 3,000 characters), and the box says so.
export type KnowledgeTestState = { slice?: KnowledgeSlice; callAnswer?: string; errors?: FormErrors; question?: string; readByChatAssistant?: boolean };

// What an import's button or form shows after it ran.
export type ImportState = { result?: ImportResult; values?: Record<string, string> };

// "New article": on success, opens the new article.
export async function createKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const input = { ...articleFields(formData), fromTicket: formData.get("fromTicket") };
  const result = await createArticleThroughCore(input);
  if (!result.ok) {
    return result.errors;
  }
  refreshKnowledgePages();
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(`/knowledge/${result.articleId}`);
}

export async function editKnowledgeArticleAction(_previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
  await requireSessionContext();
  const input = { ...articleFields(formData), articleId: formData.get("articleId"), revision: formData.get("revision") };
  const result = await editArticleThroughCore(input);
  if (!result.ok) {
    return { errors: result.errors };
  }
  refreshKnowledgePages();
  return { saved: true };
}

export async function approveKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  const input = { articleId: formData.get("articleId"), revision: formData.get("revision") };
  return refreshOrReturnErrors(await changeArticleStatusThroughCore(input.articleId, "approve", input.revision));
}

export async function archiveKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await changeArticleStatusThroughCore(formData.get("articleId"), "archive"));
}

export async function restoreKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  return refreshOrReturnErrors(await changeArticleStatusThroughCore(formData.get("articleId"), "restore"));
}

// On success the article is gone, so its page leads back to the list.
export async function deleteKnowledgeArticleAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const result = await deleteArticleThroughCore(formData.get("articleId"));
  if (!result.ok) {
    return result.errors;
  }
  refreshKnowledgePages();
  redirect("/knowledge");
}

// Nothing is saved: the question is only searched for, and sent back so the
// box shows it again.
export async function testKnowledgeSearchAction(_previous: KnowledgeTestState | undefined, formData: FormData): Promise<KnowledgeTestState> {
  await requireSessionContext();
  const question = String(formData.get("question") ?? "").slice(0, 1000);
  const result = await testKnowledgeThroughCore(formData.get("question"));
  return result.ok ? { slice: result.slice, callAnswer: result.callAnswer, question, readByChatAssistant: true } : { errors: result.errors, question };
}

export async function importDocumentToKnowledgeAction(_previous: ImportState | undefined, formData: FormData): Promise<ImportState> {
  await requireSessionContext();
  const result = await importDocumentThroughCore(formData.get("documentId"));
  if (result.ok) {
    refreshKnowledgePages();
  }
  return { result };
}

export async function importWebPageAction(_previous: ImportState | undefined, formData: FormData): Promise<ImportState> {
  await requireSessionContext();
  const result = await importWebPageThroughCore(formData.get("url"));
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
