import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { companyDocuments, knowledgeArticles } from "./schema";

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
  // Every column named, never a spread of `document`: an object with extra
  // fields (a companyId of its own) can't write them.
  await db.insert(companyDocuments).values({
    companyId,
    id: document.id,
    fileName: document.fileName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    storageKey: document.storageKey,
    uploadedByUserId: document.uploadedByUserId,
  });
}

// How many documents one company has stored, and their size together, in bytes.
export async function getDocumentTotalsForCompany(companyId: string): Promise<{ count: number; totalBytes: number }> {
  const [totals] = await db
    .select({
      count: count(),
      // sum() of integers comes back as a bigint, which the driver hands over as text.
      totalBytes: sql<number>`coalesce(sum(${companyDocuments.sizeBytes}), 0)`.mapWith(Number),
    })
    .from(companyDocuments)
    .where(eq(companyDocuments.companyId, companyId));
  return { count: totals?.count ?? 0, totalBytes: totals?.totalBytes ?? 0 };
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

// Deletes one document row of one company, in ONE transaction that first
// clears the reference of the knowledge articles made from it (step 34): the
// articles stay, only "From <file name>" goes. The row is locked first, so an
// import saving articles from it at that moment either finishes before (and
// its articles are cleared here) or finds the document gone. Returns the
// storage key, so the caller can delete the file too.
export async function deleteCompanyDocument(companyId: string, documentId: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [document] = await tx
      .select({ id: companyDocuments.id })
      .from(companyDocuments)
      .where(and(eq(companyDocuments.id, documentId), eq(companyDocuments.companyId, companyId)))
      .for("update");
    if (!document) {
      return null;
    }
    await tx
      .update(knowledgeArticles)
      .set({ sourceDocumentId: null })
      .where(and(eq(knowledgeArticles.companyId, companyId), eq(knowledgeArticles.sourceDocumentId, documentId)));
    const [deleted] = await tx
      .delete(companyDocuments)
      .where(and(eq(companyDocuments.id, documentId), eq(companyDocuments.companyId, companyId)))
      .returning({ storageKey: companyDocuments.storageKey });
    return deleted?.storageKey ?? null;
  });
}
