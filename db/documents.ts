import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { companyDocuments } from "./schema";

export type CompanyDocument = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
};

const columns = {
  id: companyDocuments.id,
  fileName: companyDocuments.fileName,
  contentType: companyDocuments.contentType,
  sizeBytes: companyDocuments.sizeBytes,
  storageKey: companyDocuments.storageKey,
  createdAt: companyDocuments.createdAt,
};

// Records an uploaded document of one company (the file is already stored).
export async function insertCompanyDocument(
  companyId: string,
  document: Omit<CompanyDocument, "createdAt"> & { uploadedByUserId: string },
): Promise<void> {
  await db.insert(companyDocuments).values({ companyId, ...document });
}

// Lists one company's documents, newest first.
export async function getDocumentsForCompany(companyId: string): Promise<CompanyDocument[]> {
  return db.select(columns).from(companyDocuments).where(eq(companyDocuments.companyId, companyId)).orderBy(desc(companyDocuments.createdAt));
}

// Reads one document of one company.
export async function getCompanyDocument(companyId: string, documentId: string): Promise<CompanyDocument | undefined> {
  const [document] = await db
    .select(columns)
    .from(companyDocuments)
    .where(and(eq(companyDocuments.id, documentId), eq(companyDocuments.companyId, companyId)));
  return document;
}

// Deletes one document row of one company. Returns its storage key, so the
// caller can delete the file too.
export async function deleteCompanyDocument(companyId: string, documentId: string): Promise<string | null> {
  const [deleted] = await db
    .delete(companyDocuments)
    .where(and(eq(companyDocuments.id, documentId), eq(companyDocuments.companyId, companyId)))
    .returning({ storageKey: companyDocuments.storageKey });
  return deleted?.storageKey ?? null;
}
