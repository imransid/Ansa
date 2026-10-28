// Document cap checks (step 26): one company keeps at most 100 documents and
// 200 MB in storage. Above that an upload is refused until something is
// deleted, and another company's documents never count.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { companyDocuments } from "@/db/schema";
import type { FormResult } from "@/lib/form-result";
import {
  deleteDocumentForSession,
  listDocumentsForSession,
  MAX_DOCUMENT_STORAGE_BYTES_PER_COMPANY,
  MAX_DOCUMENTS_PER_COMPANY,
  uploadDocumentForSession,
} from "@/services/documents";
import { check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

function textFile(name: string, sizeBytes: number): File {
  return new File(["x".repeat(sizeBytes)], name, { type: "" });
}

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

// Document rows as if files had been uploaded earlier. No files: only the
// totals matter here.
async function pretendStored(owner: TestUser, count: number, sizeBytes: number): Promise<void> {
  const rows = Array.from({ length: count }, () => {
    const id = randomUUID();
    return {
      id,
      companyId: owner.companyId,
      fileName: `earlier-${runId}.txt`,
      contentType: "text/plain",
      sizeBytes,
      storageKey: `documents/${owner.companyId}/${id}.txt`,
      uploadedByUserId: owner.id,
    };
  });
  await db.insert(companyDocuments).values(rows);
}

export async function runDocumentCapChecks() {
  await check("documents: a company keeps at most 100 files; one more is refused until one is deleted; others' files don't count", async () => {
    const ownerUser = await signUpTestOwner("doc-count");
    const owner = sessionFor(ownerUser);
    await pretendStored(await signUpTestOwner("doc-count-other"), 50, 10);
    await pretendStored(ownerUser, MAX_DOCUMENTS_PER_COMPANY - 1, 10);
    assert.deepEqual(await uploadDocumentForSession(owner, textFile("hundredth.txt", 10)), { ok: true });
    assert.match(messageOf(await uploadDocumentForSession(owner, textFile("one-too-many.txt", 10))), /storage limit/);
    const [newest] = await listDocumentsForSession(owner);
    assert.equal(newest.fileName, "hundredth.txt");
    assert.deepEqual(await deleteDocumentForSession(owner, { documentId: newest.id }), { ok: true });
    assert.deepEqual(await uploadDocumentForSession(owner, textFile("room-again.txt", 10)), { ok: true });
  });

  await check("documents: a company keeps at most 200 MB in all", async () => {
    const ownerUser = await signUpTestOwner("doc-size");
    const owner = sessionFor(ownerUser);
    await pretendStored(ownerUser, 1, MAX_DOCUMENT_STORAGE_BYTES_PER_COMPANY - 10);
    assert.match(messageOf(await uploadDocumentForSession(owner, textFile("too-big-now.txt", 20))), /storage limit/);
    assert.deepEqual(await uploadDocumentForSession(owner, textFile("still-fits.txt", 5)), { ok: true });
  });
}
