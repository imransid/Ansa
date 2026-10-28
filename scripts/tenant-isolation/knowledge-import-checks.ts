// Knowledge import and support checks (step 34): "Add to knowledge" turns a
// Setup document into drafts (owners only, the company's own documents only,
// new drafts every time, a long text in parts, a scan-like PDF refused);
// deleting the document keeps its articles; "Import a web page" makes drafts
// from a public page through the safe fetch (fake server) and logs only a
// fixed line with an error code; "Save as knowledge" links the article to a
// solved ticket of the company only; and a ticket's "Related knowledge"
// lists only its own company's approved support articles.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { knowledgeArticles } from "@/db/schema";
import type { HttpsRequester, HttpsRequestHandle, HttpsResponse } from "@/lib/safe-fetch";
import { deleteDocumentForSession, listDocumentsForSession, uploadDocumentForSession } from "@/services/documents";
import { createKnowledgeArticleForSession, getKnowledgeArticleForSession, getSolvedTicketForArticleForSession } from "@/services/knowledge";
import { importDocumentToKnowledgeForSession, NO_TEXT_IN_FILE } from "@/services/knowledge-import";
import { listRelatedKnowledgeForTicketForSession } from "@/services/knowledge-search";
import { importWebPageToKnowledgeForSession } from "@/services/knowledge-web-import";
import { closeTicketWithoutEmailForSession } from "@/services/ticket-status";
import { createTicketForCompany } from "@/services/tickets";
import { addTeammate, captureConsole, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { approvedArticle, articleForm, writeArticle } from "./knowledge-helpers";

const FIXTURES = path.join(process.cwd(), "scripts", "tenant-isolation", "fixtures");

// Uploads a file as the owner (the real Setup upload) and returns its id.
async function uploadDocument(owner: ReturnType<typeof sessionFor>, name: string, bytes: Buffer): Promise<string> {
  assert.deepEqual(await uploadDocumentForSession(owner, new File([new Uint8Array(bytes)], name)), { ok: true });
  const documents = await listDocumentsForSession(owner);
  return documents.find((document) => document.fileName === name)!.id;
}

// The company's articles made from one document, oldest first.
function articlesFrom(documentId: string) {
  return db
    .select({ title: knowledgeArticles.title, body: knowledgeArticles.body, kind: knowledgeArticles.kind, status: knowledgeArticles.status })
    .from(knowledgeArticles)
    .where(eq(knowledgeArticles.sourceDocumentId, documentId))
    .orderBy(asc(knowledgeArticles.createdAt), asc(knowledgeArticles.title));
}

// One public page at https://help.example.test/returns, served by a fake.
function fakeHelpCenter(html: string): { request: HttpsRequester; resolve: (host: string) => Promise<{ address: string; family: number }[]> } {
  const request: HttpsRequester = (_options, onResponse) => {
    const handle = new EventEmitter() as EventEmitter & HttpsRequestHandle;
    handle.destroy = () => handle;
    handle.end = () => {
      const response: HttpsResponse = Object.assign(Readable.from([Buffer.from(html)]), { statusCode: 200, headers: { "content-type": "text/html" } });
      setImmediate(() => onResponse(response));
      return handle;
    };
    return handle;
  };
  return { request, resolve: async () => [{ address: "93.184.215.14", family: 4 }] };
}

export async function runKnowledgeImportChecks(ownerA: TestUser, ownerB: TestUser) {
  await check("knowledge import: a Setup document becomes drafts of kind document, again each time; members and other companies can't", async () => {
    const ownerUser = await signUpTestOwner("knowledge-documents");
    const owner = sessionFor(ownerUser);
    const docx = await uploadDocument(owner, "returns-policy.docx", await readFile(path.join(FIXTURES, "returns-policy.docx")));
    assert.deepEqual(await importDocumentToKnowledgeForSession(owner, { documentId: docx }), { ok: true, createdCount: 1, wasCut: false });
    assert.deepEqual(await importDocumentToKnowledgeForSession(owner, { documentId: docx }), { ok: true, createdCount: 1, wasCut: false });
    const fromDocx = await articlesFrom(docx);
    const expected = { title: "returns-policy.docx", body: "Returns policy\n\nUnused items can be returned within 30 days for a full refund.", kind: "document", status: "draft" };
    assert.deepEqual(fromDocx, [expected, expected]);
    const pdf = await uploadDocument(owner, "shipping-times.pdf", await readFile(path.join(FIXTURES, "shipping-times.pdf")));
    assert.deepEqual(await importDocumentToKnowledgeForSession(owner, { documentId: pdf }), { ok: true, createdCount: 1, wasCut: false });
    assert.equal((await articlesFrom(pdf))[0].body, "Shipping times\nOrders ship within 2 business days.");
    const scan = await uploadDocument(owner, "scan.pdf", await readFile(path.join(FIXTURES, "no-text.pdf")));
    assert.deepEqual(await importDocumentToKnowledgeForSession(owner, { documentId: scan }), { ok: false, errors: { message: NO_TEXT_IN_FILE } });
    const member = sessionFor(await addTeammate(ownerUser, "knowledge-documents-member", "member"));
    assert.deepEqual(await importDocumentToKnowledgeForSession(member, { documentId: docx }), { ok: false, errors: { message: "Only owners can add documents to knowledge." } });
    assert.deepEqual(await importDocumentToKnowledgeForSession(sessionFor(ownerB), { documentId: docx }), { ok: false, errors: { message: "Document not found." } });
    assert.equal((await articlesFrom(docx)).length, 2, "a refused import saved something");
  });

  await check("knowledge import: a long text becomes parts of at most 20,000 characters; deleting the document keeps them", async () => {
    const owner = sessionFor(await signUpTestOwner("knowledge-long-document"));
    const paragraphs = Array.from({ length: 45 }, (_, index) => `Paragraph ${index}. ${"Lorem ipsum dolor. ".repeat(50)}`.trim()).join("\n\n");
    const documentId = await uploadDocument(owner, "Manual.txt", Buffer.from(paragraphs));
    const imported = await importDocumentToKnowledgeForSession(owner, { documentId });
    assert.deepEqual(imported, { ok: true, createdCount: 3, wasCut: false });
    const parts = await articlesFrom(documentId);
    assert.deepEqual(parts.map((part) => part.title).sort(), ["Manual.txt (part 1 of 3)", "Manual.txt (part 2 of 3)", "Manual.txt (part 3 of 3)"]);
    const [first] = await db.select({ id: knowledgeArticles.id }).from(knowledgeArticles).where(eq(knowledgeArticles.sourceDocumentId, documentId)).limit(1);
    assert.equal((await getKnowledgeArticleForSession(owner, first.id))?.sourceDocumentName, "Manual.txt");
    assert.deepEqual(await deleteDocumentForSession(owner, { documentId }), { ok: true });
    const afterDelete = await getKnowledgeArticleForSession(owner, first.id);
    assert.ok(afterDelete, "deleting the document deleted its article");
    assert.equal(afterDelete.sourceDocumentName, null);
  });

  await check("knowledge import: a public web page becomes drafts of kind website named after its title; a private address is refused with one fixed log line", async () => {
    const owner = sessionFor(await signUpTestOwner("knowledge-web"));
    const helpCenter = fakeHelpCenter("<html><head><title>Returns &amp; refunds</title><style>p{}</style></head><body><h1>Returns</h1><p>Send it back within 30 days.</p></body></html>");
    const url = `https://help.example.test/returns?run=${runId}`;
    assert.deepEqual(await importWebPageToKnowledgeForSession(owner, { url }, helpCenter), { ok: true, createdCount: 1, wasCut: false });
    const [article] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.companyId, owner.companyId));
    assert.deepEqual([article.title, article.body, article.kind, article.status, article.sourceUrl], ["Returns & refunds", "Returns\n\nSend it back within 30 days.", "website", "draft", url]);
    const { result, logs } = await captureConsole(() => importWebPageToKnowledgeForSession(owner, { url: `https://169.254.169.254/latest?run=${runId}` }, helpCenter));
    assert.deepEqual(result, { ok: false, errors: { fieldErrors: { url: ["That address leads to a private network, so it can't be imported."] } } });
    assert.deepEqual(logs, ["Knowledge web import failed: private_address"]);
    const http = await importWebPageToKnowledgeForSession(owner, { url: "http://help.example.test/" }, helpCenter);
    assert.ok(!http.ok && http.errors.fieldErrors?.url, "an http address was accepted");
    const member = sessionFor(await addTeammate(await signUpTestOwner("knowledge-web-team"), "knowledge-web-member", "member"));
    assert.deepEqual(await importWebPageToKnowledgeForSession(member, { url }, helpCenter), { ok: false, errors: { message: "Only owners can import web pages." } });
  });

  await check("knowledge import: a web page's title is read whole when letters before it lower-case longer (Turkish İ)", async () => {
    const owner = sessionFor(await signUpTestOwner("knowledge-web-title"));
    const turkishPage = fakeHelpCenter('<html><head><meta name="description" content="İade ve İletişim"><TITLE>İade Politikası</TITLE></head><body><p>14 gün.</p></body></html>');
    const imported = await importWebPageToKnowledgeForSession(owner, { url: "https://help.example.test/iade" }, turkishPage);
    assert.deepEqual(imported, { ok: true, createdCount: 1, wasCut: false });
    const [article] = await db.select({ title: knowledgeArticles.title }).from(knowledgeArticles).where(eq(knowledgeArticles.companyId, owner.companyId));
    assert.equal(article.title, "İade Politikası");
  });

  await check("save as knowledge: only a solved ticket of the session's company becomes the article's source", async () => {
    const ownerXUser = await signUpTestOwner("knowledge-ticket-x");
    const ownerYUser = await signUpTestOwner("knowledge-ticket-y");
    const ownerX = sessionFor(ownerXUser);
    const ownerY = sessionFor(ownerYUser);
    // Y's ticket #1 is solved; X has no ticket at all yet.
    const yTicket = await createTicketForCompany(ownerYUser.companyId, { subject: "Kettle stopped heating", description: "x", channel: "phone" });
    assert.deepEqual(await closeTicketWithoutEmailForSession(ownerY, { ticketId: yTicket.id }), { ok: true });
    assert.deepEqual(await getSolvedTicketForArticleForSession(ownerY, String(yTicket.ticketNumber)), { ticketNumber: yTicket.ticketNumber, subject: "Kettle stopped heating" });
    assert.equal(await getSolvedTicketForArticleForSession(ownerX, String(yTicket.ticketNumber)), null);
    const fromOtherCompany = await createKnowledgeArticleForSession(ownerX, { ...articleForm({ title: "Kettle", body: "Descale it.", kind: "solution" }), fromTicket: String(yTicket.ticketNumber) });
    assert.ok(fromOtherCompany.ok);
    assert.equal((await getKnowledgeArticleForSession(ownerX, fromOtherCompany.articleId))?.sourceTicketNumber, null);
    // X's own open ticket is no source either; once solved, it is.
    const xTicket = await createTicketForCompany(ownerXUser.companyId, { subject: "Toaster", description: "x", channel: "phone" });
    const fromOpen = await createKnowledgeArticleForSession(ownerX, { ...articleForm({ title: "Toaster", body: "Clean it." }), fromTicket: String(xTicket.ticketNumber) });
    assert.ok(fromOpen.ok);
    assert.equal((await getKnowledgeArticleForSession(ownerX, fromOpen.articleId))?.sourceTicketNumber, null);
    assert.deepEqual(await closeTicketWithoutEmailForSession(ownerX, { ticketId: xTicket.id }), { ok: true });
    const fromSolved = await createKnowledgeArticleForSession(ownerX, { ...articleForm({ title: "Toaster", body: "Clean it." }), fromTicket: String(xTicket.ticketNumber) });
    assert.ok(fromSolved.ok);
    assert.equal((await getKnowledgeArticleForSession(ownerX, fromSolved.articleId))?.sourceTicketNumber, xTicket.ticketNumber);
    for (const odd of ["abc", "-1", "0", undefined]) {
      const plain = await createKnowledgeArticleForSession(ownerX, { ...articleForm({ title: "Plain", body: "x" }), fromTicket: odd });
      assert.ok(plain.ok, `fromTicket ${odd} was refused`);
    }
  });

  await check("related knowledge: a ticket lists up to 3 of its own company's approved support articles, one piece each", async () => {
    const asOwnerA = sessionFor(ownerA);
    const word = `kettle${runId.replace(/\W/g, "")}`;
    const mine = await Promise.all([1, 2, 3, 4].map((index) => approvedArticle(asOwnerA, { title: `${word} fix ${index}`, body: `Descale the ${word}.\n\nThen ${word} again.` })));
    await writeArticle(asOwnerA, { title: `${word} draft`, body: `Draft ${word}` });
    await approvedArticle(sessionFor(ownerB), { title: `${word} of company B`, body: `${word} elsewhere` });
    const ticket = { subject: `My ${word} is broken`, category: null };
    const related = await listRelatedKnowledgeForTicketForSession(asOwnerA, ticket);
    assert.equal(related.length, 3);
    assert.equal(new Set(related.map((article) => article.articleId)).size, 3, "one article listed twice");
    assert.ok(related.every((article) => mine.includes(article.articleId)), "another company's article or a draft was listed");
    assert.deepEqual(await listRelatedKnowledgeForTicketForSession(asOwnerA, { subject: "Zzqx nothing matches", category: null }), []);
  });
}
