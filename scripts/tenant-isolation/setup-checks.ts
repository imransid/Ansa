// Setup checks (steps 16 and 24): only owners change company setup or
// documents; support addresses are a per-company list (another company listing
// the same address changes nothing) that can't hold ansa's own addresses;
// phone numbers are read-only, with their last call, and only unlinked while
// they have no calls; documents are limited in type and size, stored under
// their company, downloadable by that company only, deleted together with
// their file, and never logged by name.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine, deletePhoneLine } from "@/db/phone-lines";
import { companies, companyDocuments } from "@/db/schema";
import { readFromDevFiles } from "@/adapters/dev-file-storage";
import { getInboundEmailDomain } from "@/lib/forwarding-address";
import { getSendingAddress } from "@/lib/send-email";
import { MAX_DOCUMENT_BYTES } from "@/lib/document-files";
import { deleteDocumentForSession, getDocumentForSession, listDocumentsForSession, uploadDocumentForSession } from "@/services/documents";
import {
  addInboundAddressForSession,
  getSetupForSession,
  removeInboundAddressForSession,
  setReplyToEmailForSession,
} from "@/services/setup";
import { addTeammate, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";
import { forwardingAddressOf } from "./resend-helpers";

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
      await addInboundAddressForSession(member, { address: `member-${runId}@acme.test` }),
      await removeInboundAddressForSession(member, { address: `support-${runId}@acme.test` }),
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

  await check("setup: support addresses are per company: B listing A's address changes nothing for A", async () => {
    const address = `setup-${runId}@acme.test`;
    assert.equal((await addInboundAddressForSession(owner, { address })).ok, true);
    const again = await addInboundAddressForSession(owner, { address: address.toUpperCase() });
    assert.deepEqual(again.ok ? [] : again.errors.fieldErrors?.address, ["You already added that address."]);
    assert.equal((await addInboundAddressForSession(sessionFor(ownerB), { address })).ok, true);
    assert.equal((await removeInboundAddressForSession(sessionFor(ownerB), { address })).ok, true);
    const addressesOfA = (await getSetupForSession(owner)).inboundAddresses;
    assert.equal(addressesOfA.filter((listed) => listed === address).length, 1);
    assert.ok(!(await getSetupForSession(sessionFor(ownerB))).inboundAddresses.includes(address));
  });

  await check("setup: ansa's own addresses can't be a support address or the reply-to, in any letter case", async () => {
    const ansaAddresses = [
      getSendingAddress(),
      ` ${getSendingAddress().toUpperCase()} `,
      await forwardingAddressOf(ownerA),
      await forwardingAddressOf(ownerB),
      `support-${runId}@${getInboundEmailDomain().toUpperCase()}`,
    ];
    for (const address of ansaAddresses) {
      assert.equal((await addInboundAddressForSession(owner, { address })).ok, false, address);
      assert.equal((await setReplyToEmailForSession(owner, { replyToEmail: address })).ok, false, address);
    }
    const listed = (await getSetupForSession(owner)).inboundAddresses;
    assert.ok(ansaAddresses.every((address) => !listed.includes(address.trim().toLowerCase())));
    assert.equal(await replyToOf(ownerA.companyId), null);
  });

  await check("setup: only the owning company's owner can remove a support address", async () => {
    const address = `setup-${runId}@acme.test`;
    assert.equal((await removeInboundAddressForSession(sessionFor(ownerB), { address })).ok, false);
    assert.equal((await removeInboundAddressForSession(member, { address })).ok, false);
    assert.ok((await getSetupForSession(owner)).inboundAddresses.includes(address));
    assert.equal((await removeInboundAddressForSession(owner, { address: address.toUpperCase() })).ok, true);
    assert.ok(!(await getSetupForSession(owner)).inboundAddresses.includes(address));
  });

  await check("setup: owners can't add or remove phone numbers; Setup lists the company's own, with their last call", async () => {
    const phoneFunctions = Object.keys(await import("@/services/setup")).filter((name) => /phone/i.test(name));
    assert.deepEqual(phoneFunctions, [], "a setup service still changes phone numbers");
    await createPhoneLine(ownerA.companyId, `pn-setup-${runId}`);
    const linesOfA = (await getSetupForSession(member)).phoneLines;
    const lineWithCalls = linesOfA.find((line) => line.vapiPhoneNumberId === `pn-recording-${runId}`);
    const newLine = linesOfA.find((line) => line.vapiPhoneNumberId === `pn-setup-${runId}`);
    // The recording checks made calls on pn-recording.
    assert.ok(lineWithCalls?.lastCallAt instanceof Date, "no last call on a number with calls");
    assert.equal(newLine?.lastCallAt, null);
    const linesOfB = (await getSetupForSession(sessionFor(ownerB))).phoneLines.map((line) => line.vapiPhoneNumberId);
    assert.ok(linesOfB.includes(`pn-b-${runId}`), "B's own number (vapi checks) is missing");
    assert.ok(!linesOfB.includes(`pn-recording-${runId}`) && !linesOfB.includes(`pn-setup-${runId}`), "B sees A's numbers");
  });

  await check("phone numbers: unlinking (operator script) is company-scoped, and a number with calls stays", async () => {
    assert.equal(await deletePhoneLine(ownerB.companyId, `pn-setup-${runId}`), false);
    await assert.rejects(deletePhoneLine(ownerA.companyId, `pn-recording-${runId}`));
    const remaining = (await getSetupForSession(owner)).phoneLines.map((line) => line.vapiPhoneNumberId);
    assert.ok(remaining.includes(`pn-setup-${runId}`) && remaining.includes(`pn-recording-${runId}`));
    assert.equal(await deletePhoneLine(ownerA.companyId, `pn-setup-${runId}`), true);
    assert.ok(!(await getSetupForSession(owner)).phoneLines.some((line) => line.vapiPhoneNumberId === `pn-setup-${runId}`));
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
    assert.ok(download !== "rate-limited" && download?.access.kind === "bytes" && download.access.bytes.toString() === `notes ${runId}`);
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
