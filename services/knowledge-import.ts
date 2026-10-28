import "server-only";
import { getCompanyDocument } from "@/db/documents";
import { createKnowledgeArticles, type NewArticleSource } from "@/db/knowledge-writes";
import { readPrivateFile } from "@/lib/file-storage";
import type { FormErrors } from "@/lib/form-result";
import { splitImportedText } from "@/lib/knowledge/article-parts";
import { extractDocumentText } from "@/lib/knowledge/extract-text";
import type { KnowledgeKind } from "@/lib/knowledge/kinds";
import { canManageKnowledge } from "@/lib/knowledge/permissions";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import type { SessionContext } from "@/lib/session";
import { documentImportSchema } from "@/lib/validation/knowledge";
import { companyFullMessage } from "./knowledge";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Imports into the company's knowledge (step 34): "Add to knowledge" on a
// Setup document here, "Import a web page" in services/knowledge-web-import.ts.
// Both make DRAFTS, used by no AI until an owner approves them, and both are
// for owners only. Importing the same document again makes new drafts.
//
// LOGGING RULE for this file: never a file name, a storage key or an error
// message. Fixed strings and error classes only.

// What an import gives back to its button or form.
export type ImportResult = { ok: true; createdCount: number; wasCut: boolean } | { ok: false; errors: FormErrors };

export const NO_TEXT_IN_FILE = "No text could be read from this file; a scanned PDF has none.";
export const TOO_MANY_IMPORTS = "Your company has imported a lot in the last hour. Try again later.";
// Turns one of the session company's documents into draft articles of kind
// "document": its text, cut into articles of at most 20,000 characters.
export async function importDocumentToKnowledgeForSession(session: SessionContext, input: unknown): Promise<ImportResult> {
  if (!canManageKnowledge(session.role)) {
    return refused("Only owners can add documents to knowledge.");
  }
  const parsed = documentImportSchema.safeParse(input);
  if (!parsed.success) {
    return refused("Unknown document.");
  }
  if (await isOverImportLimit(session)) {
    return refused(TOO_MANY_IMPORTS);
  }
  const document = await getCompanyDocument(session.companyId, parsed.data.documentId);
  if (!document) {
    return refused("Document not found.");
  }
  const bytes = await readStoredFile(document.storageKey);
  if (bytes === "failed") {
    return refused("The file could not be read from storage right now. Try again in a few minutes.");
  }
  if (!bytes) {
    return refused("The file could not be found in storage.");
  }
  // Keys end in the extension the upload checked (services/documents.ts).
  const extension = document.storageKey.split(".").pop() ?? "";
  const extracted = await extractDocumentText(bytes, extension);
  if (!extracted.ok) {
    return refused(extracted.reason === "no-text" ? NO_TEXT_IN_FILE : "This file could not be read. It may be damaged, or not the kind of file its name says.");
  }
  const source: NewArticleSource = { type: "document", documentId: document.id };
  return saveImportedDrafts(session, { text: extracted.text, sourceName: document.fileName, kind: "document", source });
}

// Saves imported text as draft articles of the session's company, titled
// after its source ("<name> (part 2 of 3)"), meant for support only until an
// owner decides otherwise.
export async function saveImportedDrafts(
  session: SessionContext,
  imported: { text: string; sourceName: string; kind: KnowledgeKind; source: NewArticleSource },
): Promise<ImportResult> {
  const { parts, wasCut } = splitImportedText(imported.text, imported.sourceName);
  if (parts.length === 0) {
    return refused(NO_TEXT_IN_FILE);
  }
  const articles = parts.map((part) => ({ title: part.title, body: part.body, kind: imported.kind, useForSupport: true, useForMarketing: false }));
  const created = await createKnowledgeArticles(session.companyId, session.userId, articles, imported.source);
  switch (created.outcome) {
    case "created":
      return { ok: true, createdCount: created.articleIds.length, wasCut };
    case "full":
      return refused(companyFullMessage());
    case "source-gone":
      return refused("The document was deleted meanwhile.");
    case "refused":
      return refused("Only owners can import into knowledge.");
  }
}

// Counts one import against the company's hourly limit.
export async function isOverImportLimit(session: SessionContext): Promise<boolean> {
  return isOverRateLimit("knowledge-imports", session.companyId, RATE_LIMITS.knowledgeImportsPerCompany);
}

// The stored bytes, null when the file is gone, "failed" when storage didn't answer.
async function readStoredFile(storageKey: string): Promise<Buffer | null | "failed"> {
  try {
    return await readPrivateFile(storageKey);
  } catch (error) {
    console.error(`Knowledge import could not read a document: ${describeErrorWithFrames(error)}`);
    return "failed";
  }
}

function refused(message: string): ImportResult {
  return { ok: false, errors: { message } };
}
