// Setup checks (step 16): only owners change company setup or documents, a
// phone number or support address belongs to one company only, documents are
// limited in type and size, stored under their company, downloadable by that
// company only, deleted together with their file, and never logged by name.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, companyDocuments } from "@/db/schema";
import { readFromDevFiles } from "@/adapters/dev-file-storage";
import { deleteDocumentForSession, getDocumentForSession, listDocumentsForSession, MAX_DOCUMENT_BYTES, uploadDocumentForSession } from "@/services/documents";
import {
  addInboundAddressForSession,
  addPhoneLineForSession,
  getSetupForSession,
  removeInboundAddressForSession,
  removePhoneLineForSession,
  setReplyToEmailForSession,
} from "@/services/setup";
import { addTeammate, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

const fileNamed = (name: string, text = `notes ${runId}`) => new File([text], name, { type: "" });

async function replyToOf(companyId: string) {
  return (await db.select({ replyTo: companies.replyToEmail }).from(companies).where(eq(companies.id, companyId)))[0].replyTo;
}

export async function runSetupChecks(ownerA: TestUser, ownerB: TestUser) {
  const owner = sessionFor(ownerA);
  const member = sessionFor(await addTeammate(ownerA, "setup-member", "member"));

  await check("setup: members can't change company setup or documents", async () => {
    const before = await getSetupForSession(member);
    const results = [
      await setReplyToEmailForSession(member, { replyToEmail: `help-${runId}@a.test` }),
      await addPhoneLineForSession(member, { vapiPhoneNumberId: `pn-member-${runId}` }),
      await addInboundAddressForSession(member, { address: `member-${runId}@inbound.test` }),
      await uploadDocumentForSession(member, fileNamed("faq.txt")),
    ];
    assert.ok(results.every((result) => !result.ok));
    assert.deepEqual(await getSetupForSession(member), before);
  });

  await check("setup: the reply-to address is validated, saved for one company only, and can be cleared", async () => {
    assert.equal((await setReplyToEmailForSession(owner, { replyToEmail: "not an email" })).ok, false);
    const replyToOfB = await replyToOf(ownerB.companyId);
    assert.equal((await setReplyToEmailForSession(owner, { replyToEmail: `help-${runId}@a.test` })).ok, true);
    assert.equal(await replyToOf(ownerA.companyId), `help-${runId}@a.test`);
    assert.equal(await replyToOf(ownerB.companyId), replyToOfB);
    assert.equal((await setReplyToEmailForSession(owner, { replyToEmail: "" })).ok, true);
    assert.equal(await replyToOf(ownerA.companyId), null);
  });

  await check("setup: a phone number or support address can belong to one company only", async () => {
    const number = `pn-setup-${runId}`;
    const address = `setup-${runId}@inbound.test`;
    assert.equal((await addPhoneLineForSession(owner, { vapiPhoneNumberId: number })).ok, true);
    assert.equal((await addInboundAddressForSession(owner, { address })).ok, true);
    const taken = [
      await addPhoneLineForSession(sessionFor(ownerB), { vapiPhoneNumberId: number }),
      await addInboundAddressForSession(sessionFor(ownerB), { address: address.toUpperCase() }),
    ];
    assert.ok(taken.every((result) => !result.ok));
    assert.equal((await addPhoneLineForSession(owner, { vapiPhoneNumberId: "bad id!" })).ok, false);
    assert.ok((await getSetupForSession(owner)).phoneLines.includes(number));
    assert.ok(!(await getSetupForSession(sessionFor(ownerB))).phoneLines.includes(number));
    assert.ok(!(await getSetupForSession(sessionFor(ownerB))).inboundAddresses.includes(address));
  });

  await check("setup: only the owning company can unlink a number or address, and a number with calls stays", async () => {
    const number = `pn-setup-${runId}`;
    const address = `setup-${runId}@inbound.test`;
    assert.equal((await removePhoneLineForSession(sessionFor(ownerB), { vapiPhoneNumberId: number })).ok, false);
    assert.equal((await removeInboundAddressForSession(sessionFor(ownerB), { address })).ok, false);
    assert.equal((await removePhoneLineForSession(member, { vapiPhoneNumberId: number })).ok, false);
    assert.ok((await getSetupForSession(owner)).phoneLines.includes(number));
    // The recording checks made calls on this number.
    const withCalls = await removePhoneLineForSession(owner, { vapiPhoneNumberId: `pn-recording-${runId}` });
    assert.equal(withCalls.ok, false);
    assert.ok((await getSetupForSession(owner)).phoneLines.includes(`pn-recording-${runId}`));
    assert.equal((await removePhoneLineForSession(owner, { vapiPhoneNumberId: number })).ok, true);
    assert.equal((await removeInboundAddressForSession(owner, { address: address.toUpperCase() })).ok, true);
    const after = await getSetupForSession(owner);
    assert.ok(!after.phoneLines.includes(number) && !after.inboundAddresses.includes(address));
  });

  await check("documents: only PDF, Word, text, Markdown and CSV files up to 4 MB are accepted", async () => {
    for (const bad of [fileNamed("page.html"), fileNamed("logo.svg"), fileNamed("run.exe"), fileNamed("noextension"), fileNamed("empty.txt", "")]) {
      assert.equal((await uploadDocumentForSession(owner, bad)).ok, false, bad.name);
    }
    assert.equal((await uploadDocumentForSession(owner, "not a file")).ok, false);
    const tooBig = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "big.pdf");
    assert.equal((await uploadDocumentForSession(owner, tooBig)).ok, false);
    assert.equal((await listDocumentsForSession(owner)).length, 0);
  });

  await check("documents: stored under the company's folder, downloadable by that company only, names never logged", async () => {
    const name = `Refund policy ${runId}.MD`;
    const { result, logs } = await captureConsole(() => uploadDocumentForSession(owner, fileNamed(name)));
    assert.equal(result.ok, true);
    assert.ok(logs.every((line) => !line.includes(runId)), "a file name was logged");
    const [document] = await listDocumentsForSession(member);
    assert.equal(document.fileName, name);
    assert.equal(document.contentType, "text/markdown");
    assert.equal(document.storageKey, `documents/${ownerA.companyId}/${document.id}.md`);
    const download = await getDocumentForSession(member, document.id);
    assert.ok(download?.access.kind === "bytes" && download.access.bytes.toString() === `notes ${runId}`);
    assert.equal(await getDocumentForSession(sessionFor(ownerB), document.id), null);
    assert.equal(await getDocumentForSession(owner, "not-a-uuid"), null);
  });

  await check("documents: only the owning company's owner can delete, and the file goes too", async () => {
    const [document] = await listDocumentsForSession(owner);
    assert.equal((await deleteDocumentForSession(sessionFor(ownerB), { documentId: document.id })).ok, false);
    assert.equal((await deleteDocumentForSession(member, { documentId: document.id })).ok, false);
    assert.ok(await readFromDevFiles(document.storageKey));
    assert.equal((await deleteDocumentForSession(owner, { documentId: document.id })).ok, true);
    assert.equal(await readFromDevFiles(document.storageKey), null);
    assert.equal((await db.select().from(companyDocuments).where(eq(companyDocuments.id, document.id))).length, 0);
  });
}
