// File failure checks (step 32): storage that refuses a document is a message
// on the Setup page (not an error screen), a document whose file can't be
// deleted stays listed instead of leaving a file nobody can reach, and too
// many downloads or plays answer "rate-limited" (429), never "not found".
// Uses the .dev-files/ stand-in only.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileUnavailableResponse } from "@/lib/private-file-response";
import type { FormResult } from "@/lib/form-result";
import { getRecordingForSession } from "@/services/call-recordings";
import { deleteDocumentForSession, getDocumentForSession, listDocumentsForSession, uploadDocumentForSession } from "@/services/documents";
import { RATE_LIMITS } from "@/services/rate-limit";
import { addTeammate, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";

const DEV_FILES = path.join(process.cwd(), ".dev-files");

const textFile = (name: string) => new File([`notes ${runId}`], name, { type: "" });

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

export async function runFileFailureChecks() {
  const ownerUser = await signUpTestOwner("files-down");
  const owner = sessionFor(ownerUser);
  const companyFolder = path.join(DEV_FILES, "documents", ownerUser.companyId);

  await check("documents: storage that refuses the file is a message on the page, and no document is saved", async () => {
    // A plain file where the company's folder should be: every write fails.
    await mkdir(path.dirname(companyFolder), { recursive: true });
    await writeFile(companyFolder, "not a folder");
    try {
      const fileName = `price list ${runId}.txt`;
      const { result, logs } = await captureConsole(() => uploadDocumentForSession(owner, textFile(fileName)));
      assert.match(messageOf(result), /could not be stored right now, so nothing was saved/);
      assert.deepEqual(await listDocumentsForSession(owner), []);
      assert.equal(logs.length, 1);
      assert.match(logs[0], /^Document storage failed: /);
      assert.ok(!logs[0].includes(runId) && !logs[0].includes(ownerUser.companyId), "a file name or key was logged");
    } finally {
      await rm(companyFolder, { force: true });
    }
  });

  await check("documents: when the file can't be deleted, the document stays listed and deleting again works", async () => {
    assert.deepEqual(await uploadDocumentForSession(owner, textFile("policy.txt")), { ok: true });
    const [document] = await listDocumentsForSession(owner);
    const storedPath = path.join(DEV_FILES, document.storageKey);
    // A folder where the file was: removing it fails like an outage would.
    await rm(storedPath, { force: true });
    await mkdir(storedPath);
    await writeFile(path.join(storedPath, "keep"), "x");
    const { result, logs } = await captureConsole(() => deleteDocumentForSession(owner, { documentId: document.id }));
    assert.match(messageOf(result), /could not be deleted right now, so the document is still here/);
    assert.deepEqual((await listDocumentsForSession(owner)).map((listed) => listed.id), [document.id]);
    assert.ok(logs.every((line) => !line.includes(document.storageKey) && !line.includes("policy")), "a file name or key was logged");
    await rm(storedPath, { recursive: true, force: true });
    // The file is gone already: deleting a missing file works, then the row goes.
    assert.deepEqual(await deleteDocumentForSession(owner, { documentId: document.id }), { ok: true });
    assert.deepEqual(await listDocumentsForSession(owner), []);
  });

  await check("documents: too many downloads answer 'rate-limited' (429), not 'not found'; teammates are not affected", async () => {
    assert.deepEqual(await uploadDocumentForSession(owner, textFile("faq.txt")), { ok: true });
    const [document] = await listDocumentsForSession(owner);
    const busy = sessionFor(await addTeammate(ownerUser, "files-busy", "member"));
    for (let attempt = 0; attempt < RATE_LIMITS.documentDownloadsPerUser.maxAttempts; attempt++) {
      assert.notEqual(await getDocumentForSession(busy, document.id), "rate-limited", `refused at download ${attempt + 1}`);
    }
    assert.equal(await getDocumentForSession(busy, document.id), "rate-limited");
    const download = await getDocumentForSession(owner, document.id);
    assert.ok(download !== "rate-limited" && download?.access.kind === "bytes");
    assert.equal(fileUnavailableResponse("rate-limited").status, 429);
    assert.equal(fileUnavailableResponse("rate-limited").headers.get("retry-after"), "600");
    assert.equal(fileUnavailableResponse(null).status, 404);
  });

  await check("recordings: too many plays answer 'rate-limited', not 'not found'; another person is not affected", async () => {
    const listener = sessionFor(await addTeammate(ownerUser, "files-listener", "member"));
    for (let attempt = 0; attempt < RATE_LIMITS.recordingViewsPerUser.maxAttempts; attempt++) {
      assert.equal(await getRecordingForSession(listener, randomUUID()), null, `refused at play ${attempt + 1}`);
    }
    assert.equal(await getRecordingForSession(listener, randomUUID()), "rate-limited");
    assert.equal(await getRecordingForSession(owner, randomUUID()), null);
  });
}
