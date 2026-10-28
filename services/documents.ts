import "server-only";
import { randomUUID } from "node:crypto";
import {
  deleteCompanyDocument,
  getCompanyDocument,
  getDocumentsForCompany,
  getDocumentTotalsForCompany,
  insertCompanyDocument,
  type CompanyDocument,
} from "@/db/documents";
import { checkDocumentFile, EMPTY_FILE_MESSAGE } from "@/lib/document-files";
import { deletePrivateFile, getPrivateFileAccess, putPrivateFile, type PrivateFileAccess } from "@/lib/file-storage";
import type { FormResult } from "@/lib/form-result";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import type { SessionContext } from "@/lib/session";
import { documentIdSchema } from "@/lib/validation/setup";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

export type { CompanyDocument };

// LOGGING RULE for this file: never log a file name, a file key or an error
// message (a storage error can quote the key). Fixed strings and error classes.

// What one company may keep in storage in all. Signup is open and payments
// enforce nothing yet, so without a cap one account could fill the platform's
// bucket (20 uploads every 10 minutes, kept forever), at ansa's expense.
// (Which files and how big each may be: lib/document-files.ts.)
export const MAX_DOCUMENTS_PER_COMPANY = 100;
export const MAX_DOCUMENT_STORAGE_BYTES_PER_COMPANY = 200 * 1024 * 1024;
const DOCUMENT_LINK_SECONDS = 5 * 60;

// A document's download, or why there is none: null for an unknown document
// (or another company's), "rate-limited" after too many downloads.
export type DocumentDownload = { access: PrivateFileAccess; fileName: string } | "rate-limited" | null;

// Lists the session company's documents. Anyone in the company may see them.
export async function listDocumentsForSession(session: SessionContext): Promise<CompanyDocument[]> {
  return getDocumentsForCompany(session.companyId);
}

// Stores an uploaded document in private storage. Owners only.
export async function uploadDocumentForSession(session: SessionContext, file: unknown): Promise<FormResult> {
  if (session.role !== "owner") {
    return { ok: false, errors: { message: "Only owners can upload documents." } };
  }
  if (!(file instanceof File)) {
    return { ok: false, errors: { message: EMPTY_FILE_MESSAGE } };
  }
  // The same check the upload form runs in the browser.
  const checked = checkDocumentFile(file);
  if (!checked.ok) {
    return { ok: false, errors: { message: checked.message } };
  }
  if (await isOverRateLimit("document-uploads", session.userId, RATE_LIMITS.documentUploadsPerUser)) {
    return { ok: false, errors: { message: "Too many uploads. Try again in a few minutes." } };
  }
  if (await wouldPassStorageCap(session.companyId, file.size)) {
    return { ok: false, errors: { message: "Your company has reached its storage limit (100 files or 200 MB). Delete a document to make room." } };
  }

  const documentId = randomUUID();
  // The company id in the key keeps every company's files apart in the bucket.
  const storageKey = `documents/${session.companyId}/${documentId}.${checked.extension}`;
  // Storage being down or misconfigured is a failure we expect now and then:
  // the owner gets a message and keeps the page, instead of an error screen.
  try {
    await putPrivateFile(storageKey, Buffer.from(await file.arrayBuffer()), checked.contentType);
  } catch (error) {
    console.error(`Document storage failed: ${describeErrorWithFrames(error)}`);
    return { ok: false, errors: { message: "The file could not be stored right now, so nothing was saved. Try again in a few minutes." } };
  }
  await saveDocumentRowOrRemoveFile(session, { id: documentId, file, extension: checked.extension, contentType: checked.contentType, storageKey });
  return { ok: true };
}

type StoredDocument = { id: string; file: File; extension: string; contentType: string; storageKey: string };

// Saves the document's row for a file already in storage. If the row can't be
// saved, nobody could ever reach or delete the file, so it is removed (best
// effort) before the error goes on to the page's error screen.
async function saveDocumentRowOrRemoveFile(session: SessionContext, stored: StoredDocument) {
  try {
    await insertCompanyDocument(session.companyId, {
      id: stored.id,
      // Shown in the list only. Control characters removed, length capped.
      fileName: stored.file.name.replace(/\p{Cc}/gu, "").slice(0, 200) || `document.${stored.extension}`,
      contentType: stored.contentType,
      sizeBytes: stored.file.size,
      storageKey: stored.storageKey,
      uploadedByUserId: session.userId,
    });
  } catch (error) {
    await deletePrivateFile(stored.storageKey).catch(() => console.error("Could not remove the file of a document that was not saved"));
    throw error;
  }
}

// True when one more file of this size would take the company past its cap.
// Two uploads at the same moment can both pass, going over by at most a file
// or two (uploads are rate limited): fine for a cost cap, nobody gets data.
async function wouldPassStorageCap(companyId: string, fileSize: number): Promise<boolean> {
  const stored = await getDocumentTotalsForCompany(companyId);
  return stored.count >= MAX_DOCUMENTS_PER_COMPANY || stored.totalBytes + fileSize > MAX_DOCUMENT_STORAGE_BYTES_PER_COMPANY;
}

// A way to download one of the session company's documents (see DocumentDownload).
export async function getDocumentForSession(session: SessionContext, documentId: unknown): Promise<DocumentDownload> {
  const parsed = documentIdSchema.safeParse({ documentId });
  if (!parsed.success) {
    return null;
  }
  // Said apart from "not found": the route answers 429, so the person learns
  // to wait instead of thinking the document is gone.
  if (await isOverRateLimit("document-downloads", session.userId, RATE_LIMITS.documentDownloadsPerUser)) {
    return "rate-limited";
  }
  const document = await getCompanyDocument(session.companyId, parsed.data.documentId);
  if (!document) {
    return null;
  }
  const access = await getPrivateFileAccess(document.storageKey, document.contentType, DOCUMENT_LINK_SECONDS, document.fileName);
  return access ? { access, fileName: document.fileName } : null;
}

// Deletes one of the session company's documents and its file. Owners only.
// The file goes first, the row second: if storage refuses, the document stays
// listed and the owner can try again (deleting a file that is already gone
// works, in R2 and in the dev folder). The other way round, a failed file
// delete would leave a file nothing points at, for good.
export async function deleteDocumentForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  if (session.role !== "owner") {
    return { ok: false, errors: { message: "Only owners can delete documents." } };
  }
  const parsed = documentIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown document." } };
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const document = await getCompanyDocument(session.companyId, parsed.data.documentId);
  if (!document) {
    return { ok: false, errors: { message: "Document not found." } };
  }
  try {
    await deletePrivateFile(document.storageKey);
  } catch (error) {
    console.error(`Document file delete failed: ${describeErrorWithFrames(error)}`);
    return { ok: false, errors: { message: "The file could not be deleted right now, so the document is still here. Try again in a few minutes." } };
  }
  await deleteCompanyDocument(session.companyId, document.id);
  return { ok: true };
}
