import "server-only";
import { randomUUID } from "node:crypto";
import { deleteCompanyDocument, getCompanyDocument, getDocumentsForCompany, insertCompanyDocument, type CompanyDocument } from "@/db/documents";
import { deletePrivateFile, getPrivateFileAccess, putPrivateFile, type PrivateFileAccess } from "@/lib/file-storage";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { documentIdSchema } from "@/lib/validation/setup";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

export type { CompanyDocument };

// Under Vercel's 4.5 MB request limit (next.config.ts allows 5 MB actions).
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const DOCUMENT_LINK_SECONDS = 5 * 60;

// Only plain document types, chosen by extension. Browsers report types like
// .md and .csv differently, so the stored type comes from this list, never
// from the browser. Downloads are always "save as", so a mislabelled file
// can't run in our pages.
const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// Lists the session company's documents. Anyone in the company may see them.
export async function listDocumentsForSession(session: SessionContext): Promise<CompanyDocument[]> {
  return getDocumentsForCompany(session.companyId);
}

// Stores an uploaded document in private storage. Owners only.
export async function uploadDocumentForSession(session: SessionContext, file: unknown): Promise<FormResult> {
  if (session.role !== "owner") {
    return { ok: false, errors: { message: "Only owners can upload documents." } };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, errors: { message: "Choose a file to upload." } };
  }
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  const contentType = Object.hasOwn(ALLOWED_TYPES, extension) ? ALLOWED_TYPES[extension] : undefined;
  if (!contentType) {
    return { ok: false, errors: { message: "Upload a PDF, Word (.docx), text, Markdown or CSV file." } };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, errors: { message: "Files can be at most 4 MB." } };
  }
  if (await isOverRateLimit("document-uploads", session.userId, RATE_LIMITS.documentUploadsPerUser)) {
    return { ok: false, errors: { message: "Too many uploads. Try again in a few minutes." } };
  }

  const documentId = randomUUID();
  // The company id in the key keeps every company's files apart in the bucket.
  const storageKey = `documents/${session.companyId}/${documentId}.${extension}`;
  await putPrivateFile(storageKey, Buffer.from(await file.arrayBuffer()), contentType);
  try {
    await insertCompanyDocument(session.companyId, {
      id: documentId,
      // Shown in the list only. Control characters removed, length capped.
      fileName: file.name.replace(/\p{Cc}/gu, "").slice(0, 200) || `document.${extension}`,
      contentType,
      sizeBytes: file.size,
      storageKey,
      uploadedByUserId: session.userId,
    });
  } catch (error) {
    // No row means nobody could ever reach or delete the file: remove it now.
    await deletePrivateFile(storageKey);
    throw error;
  }
  return { ok: true };
}

// A way to download one of the session company's documents, or null.
export async function getDocumentForSession(session: SessionContext, documentId: unknown): Promise<{ access: PrivateFileAccess; fileName: string } | null> {
  const parsed = documentIdSchema.safeParse({ documentId });
  if (!parsed.success) {
    return null;
  }
  if (await isOverRateLimit("document-downloads", session.userId, RATE_LIMITS.documentDownloadsPerUser)) {
    return null;
  }
  const document = await getCompanyDocument(session.companyId, parsed.data.documentId);
  if (!document) {
    return null;
  }
  const access = await getPrivateFileAccess(document.storageKey, document.contentType, DOCUMENT_LINK_SECONDS, document.fileName);
  return access ? { access, fileName: document.fileName } : null;
}

// Deletes one of the session company's documents and its file. Owners only.
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
  const storageKey = await deleteCompanyDocument(session.companyId, parsed.data.documentId);
  if (!storageKey) {
    return { ok: false, errors: { message: "Document not found." } };
  }
  await deletePrivateFile(storageKey);
  return { ok: true };
}
