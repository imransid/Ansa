// Step 27, the Emails page: it lists only the session's company's received
// emails (who and when, what became of them, never the content); "Process
// again" and "Make a ticket anyway" work only on that company's emails, only
// for the right reasons (mail from its support addresses yes, without filling
// in the customer email; mail from ansa's own addresses never); an id sent in
// capitals still stores content its ticket can decrypt; and a stuck email is
// shown and can be run again. FAKE fetcher and model only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createInboundAddress } from "@/db/inbound-emails";
import { inboundEmails, tickets } from "@/db/schema";
import { getSendingAddress } from "@/lib/send-email";
import { processInboundEmail } from "@/services/inbound-email-processing";
import { makeTicketFromEmailForSession, processEmailAgainForSession } from "@/services/inbound-email-actions";
import { countInboundEmailsForSession, getOriginalEmailForSession, listInboundEmailsForSession } from "@/services/inbound-emails";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { inboundRow, plainTriageModel, receiveAndProcess, receiveEmailRow, resendContent } from "./inbound-helpers";
import { forwardingAddressOf } from "./resend-helpers";

export async function runEmailsPageChecks() {
  const owner = await signUpTestOwner("emails-page");
  const other = await signUpTestOwner("emails-page-other");
  const asOwner = sessionFor(owner);
  const asOther = sessionFor(other);
  const fakes = (label: string) => ({ fetchEmail: async () => resendContent(label), askModel: plainTriageModel() });

  await check("emails page: lists only the company's own emails, newest first, with ticket and reason, never subject or body", async () => {
    const ticketed = await receiveAndProcess(owner, "list-ticketed", resendContent("list-ticketed"));
    const skipped = await receiveAndProcess(owner, "list-skipped", resendContent("list-skipped", { headers: { "List-Id": "<news.example>" } }));
    const listed = await listInboundEmailsForSession(asOwner);
    assert.deepEqual(listed.slice(0, 2).map((email) => email.id), [skipped.id, ticketed.id], "not newest first");
    const [skippedItem, ticketedItem] = listed;
    assert.deepEqual([ticketedItem.ticketNumber, ticketedItem.status], [ticketed.ticket?.ticketNumber, "ticketed"]);
    assert.deepEqual([skippedItem.status, skippedItem.ignoredReason, skippedItem.ticketNumber, skippedItem.stuck], ["ignored", "bulk", null, false]);
    assert.ok(Object.keys(ticketedItem).every((key) => !/subject|body/i.test(key)), "the list carries content");
    assert.equal(await countInboundEmailsForSession(asOwner), listed.length);
    assert.ok(!(await listInboundEmailsForSession(asOther)).some((email) => email.id === ticketed.id || email.id === skipped.id));
  });

  await check("emails page: 'Process again' makes a ticket of an email whose content could not be fetched; another company can't", async () => {
    const id = await receiveEmailRow(owner, "unavailable");
    assert.equal(await processInboundEmail(owner.companyId, id, { fetchEmail: async () => null, askModel: plainTriageModel() }), "ignored");
    assert.equal((await inboundRow(id)).ignoredReason, "content_unavailable");
    assert.equal((await processEmailAgainForSession(asOther, { inboundEmailId: id }, fakes("unavailable"))).ok, false);
    assert.equal((await inboundRow(id)).ignoredReason, "content_unavailable", "another company changed it");
    assert.deepEqual(await processEmailAgainForSession(asOwner, { inboundEmailId: id }, fakes("unavailable")), { ok: true });
    assert.equal((await inboundRow(id)).status, "ticketed");
    assert.equal((await processEmailAgainForSession(asOwner, { inboundEmailId: "not-a-uuid" }, fakes("x"))).ok, false);
  });

  await check("emails page: 'Process again' with the email's id in capitals stores content its ticket page can still decrypt", async () => {
    const id = await receiveEmailRow(owner, "capitals");
    assert.equal(await processInboundEmail(owner.companyId, id, { fetchEmail: async () => null, askModel: plainTriageModel() }), "ignored");
    assert.deepEqual(await processEmailAgainForSession(asOwner, { inboundEmailId: id.toUpperCase() }, fakes("capitals")), { ok: true });
    const original = await getOriginalEmailForSession(asOwner, (await inboundRow(id)).ticketId!);
    assert.deepEqual([original?.unreadable, original?.subject], [false, "Parcel help capitals"]);
  });

  await check("emails page: 'Make a ticket anyway' works for skipped mail of the company only, never for mail from ansa's own addresses", async () => {
    const autoReply = await receiveAndProcess(owner, "anyway-auto", resendContent("anyway-auto", { headers: { "Auto-Submitted": "auto-replied" } }));
    assert.equal(autoReply.row.ignoredReason, "auto_reply");
    const autoReplyContent = { fetchEmail: async () => resendContent("anyway-auto", { headers: { "Auto-Submitted": "auto-replied" } }), askModel: plainTriageModel() };
    assert.equal((await makeTicketFromEmailForSession(asOther, { inboundEmailId: autoReply.id }, autoReplyContent)).ok, false);
    assert.deepEqual(await makeTicketFromEmailForSession(asOwner, { inboundEmailId: autoReply.id }, autoReplyContent), { ok: true });
    assert.equal((await inboundRow(autoReply.id)).status, "ticketed");
    const fromAnsa = () => resendContent("anyway-loop", { from: getSendingAddress(), headers: {} });
    const loop = await receiveAndProcess(owner, "anyway-loop", fromAnsa());
    assert.equal(loop.row.ignoredReason, "own_address");
    const loopContent = { fetchEmail: async () => fromAnsa(), askModel: plainTriageModel() };
    assert.equal((await makeTicketFromEmailForSession(asOwner, { inboundEmailId: loop.id }, loopContent)).ok, false);
    assert.equal((await processEmailAgainForSession(asOwner, { inboundEmailId: loop.id }, loopContent)).ok, false);
    assert.equal((await inboundRow(loop.id)).ignoredReason, "own_address");
  });

  await check("emails page: mail from a support address waits as such and can be made a ticket, never with an own address as its customer email; ansa's own addresses never, even when skipped for another reason", async () => {
    await createInboundAddress(owner.companyId, `desk-${runId}@acme.test`);
    // A mailbox rule that forwards as a new message: From is the support address, DKIM passes.
    const fromDesk = () => resendContent("anyway-desk", { from: `desk-${runId}@acme.test`, headers: {} });
    const desk = await receiveAndProcess(owner, "anyway-desk", fromDesk());
    assert.deepEqual([desk.outcome, desk.row.ignoredReason], ["ignored", "support_address"]);
    assert.deepEqual(await makeTicketFromEmailForSession(asOwner, { inboundEmailId: desk.id }, { fetchEmail: async () => fromDesk(), askModel: plainTriageModel() }), { ok: true });
    const deskRow = await inboundRow(desk.id);
    const [deskTicket] = await db.select().from(tickets).where(eq(tickets.id, deskRow.ticketId!));
    assert.deepEqual([deskRow.senderVerified, deskTicket.customerEmail], [true, null], "the company's own address became the customer email");
    // A row skipped for another reason whose sender is ansa's: still a loop, no ticket.
    const id = await receiveEmailRow(owner, "anyway-forwarding");
    await db.update(inboundEmails).set({ status: "ignored", ignoredReason: "bulk" }).where(eq(inboundEmails.id, id));
    const fromForwarding = { fetchEmail: async () => resendContent("anyway-forwarding", { from: await forwardingAddressOf(owner), headers: {} }), askModel: plainTriageModel() };
    assert.equal((await makeTicketFromEmailForSession(asOwner, { inboundEmailId: id }, fromForwarding)).ok, false);
    const row = await inboundRow(id);
    assert.deepEqual([row.status, row.ignoredReason, row.ticketId], ["ignored", "own_address", null]);
  });

  await check("emails page: an email whose run was cut off shows as stuck, and 'Process again' finishes it", async () => {
    const id = await receiveEmailRow(owner, "stuck-page");
    await db.update(inboundEmails).set({ status: "processing", processingStartedAt: new Date(Date.now() - 20 * 60 * 1000) }).where(eq(inboundEmails.id, id));
    const listed = (await listInboundEmailsForSession(asOwner)).find((email) => email.id === id);
    assert.deepEqual([listed?.status, listed?.stuck], ["processing", true]);
    assert.deepEqual(await processEmailAgainForSession(asOwner, { inboundEmailId: id }, fakes("stuck-page")), { ok: true });
    const fresh = await receiveEmailRow(owner, "fresh-page");
    assert.equal((await listInboundEmailsForSession(asOwner)).find((email) => email.id === fresh)?.stuck, false);
  });
}
