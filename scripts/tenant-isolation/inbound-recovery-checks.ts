// Step 27, nothing gets lost: an email whose processing fails after its
// content arrived still becomes a (fallback) ticket, odd but valid senders
// (control characters and over-long From texts included) and Claude answers a
// little off still become tickets, a category renamed while Claude thinks is
// followed, and a run that was cut off is claimed again after 15 minutes
// (never while it may still run). Fetching from Resend is checked in
// resend-receiving-checks.ts. FAKE fetcher and model only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { markInboundEmailIgnored } from "@/db/inbound-email-processing";
import { inboundEmails } from "@/db/schema";
import { renameCategoryForSession, setCategoryArchivedForSession } from "@/services/categories";
import { processInboundEmail } from "@/services/inbound-email-processing";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { inboundRow, plainTriageModel, receiveAndProcess, receiveEmailRow, resendContent, senderFor } from "./inbound-helpers";
import { addCategory } from "./team-helpers";

export async function runInboundRecoveryChecks() {
  const owner = await signUpTestOwner("recovery");
  const otherOwner = await signUpTestOwner("recovery-other");

  await check("inbound recovery: a failure after the content arrived still saves one ticket, without the AI's work, logging the class only", async () => {
    const secret = `secret-body-${runId}`;
    const crash = fakeModel(() => {
      throw new TypeError(`boom ${secret}`);
    }).ask;
    const { outcome, logs, row, ticket } = await receiveAndProcess(owner, "crash", resendContent("crash", { subject: `Refund ${runId}`, text: secret }), crash);
    assert.equal(outcome, "ticketed");
    assert.deepEqual([ticket?.subject, ticket?.category], [`Refund ${runId}`, null]);
    assert.match(ticket?.description ?? "", /No AI summary or category: processing the email failed/);
    assert.equal(ticket?.customerEmail, senderFor("crash"), "the verified sender was dropped");
    assert.ok(row.bodyEncrypted?.startsWith("v1:"), "the original email was not kept");
    assert.deepEqual(logs, ["Inbound email triage failed, saving it without the AI: TypeError"]);
  });

  await check("inbound recovery: odd but valid senders still become tickets (long or quoted names, 'address (Name)', international domains)", async () => {
    const cases = [
      { label: "long-name", from: senderFor("long-name"), header: `${"N".repeat(230)} <${senderFor("long-name")}>`, name: "N".repeat(200), email: senderFor("long-name") },
      { label: "quoted", from: `"Sam \\"Ace\\" Okafor" <${senderFor("quoted")}>`, header: "", name: 'Sam "Ace" Okafor', email: senderFor("quoted") },
      { label: "angle", from: `"Sam <Ace>" <${senderFor("angle")}>`, header: "", name: "Sam <Ace>", email: senderFor("angle") },
      { label: "comment", from: `${senderFor("comment")} (Sam Okafor)`, header: "", name: "Sam Okafor", email: senderFor("comment") },
      { label: "idn", from: `ivan-${runId}@почта.рф`, header: "", name: null, email: `ivan-${runId}@xn--80a1acny.xn--p1ai` },
    ];
    for (const sample of cases) {
      const content = resendContent(sample.label, { from: sample.from, headers: sample.header ? { from: sample.header } : {} });
      const { outcome, ticket } = await receiveAndProcess(owner, `odd-${sample.label}`, content);
      assert.equal(outcome, "ticketed", sample.label);
      assert.deepEqual([ticket?.customerName, ticket?.customerEmail], [sample.name, sample.email], sample.label);
    }
  });

  await check("inbound recovery: no From, or a From with no address, still becomes a ticket without a customer email", async () => {
    const missing = await receiveAndProcess(owner, "no-from", resendContent("no-from", { from: "", headers: {} }));
    assert.deepEqual([missing.outcome, missing.ticket?.customerEmail, missing.row.fromAddress], ["ticketed", null, null]);
    const noAddress = await receiveAndProcess(owner, "no-address", resendContent("no-address", { from: "Kim Lee", headers: {} }));
    assert.deepEqual([noAddress.outcome, noAddress.ticket?.customerEmail, noAddress.row.fromAddress], ["ticketed", null, "kim lee"]);
  });

  await check("inbound recovery: a blank or too-long Claude subject keeps Claude's summary and category", async () => {
    await addCategory(owner, "Billing");
    const blankModel = fakeModel(answer({ customer_issue: "Asks about an invoice.", ticket_subject: "   ", category: "Billing" })).ask;
    const blank = await receiveAndProcess(owner, "blank-subject", resendContent("blank-subject", { subject: "Invoice question" }), blankModel);
    assert.deepEqual([blank.outcome, blank.ticket?.subject, blank.ticket?.category], ["ticketed", "Invoice question", "Billing"]);
    assert.ok(blank.ticket?.description.startsWith("Asks about an invoice."), "Claude's summary was lost");
    const longModel = fakeModel(answer({ customer_issue: "x".repeat(600), ticket_subject: "S".repeat(83), category: "Billing" })).ask;
    const long = await receiveAndProcess(owner, "long-subject", resendContent("long-subject"), longModel);
    assert.deepEqual([long.ticket?.subject, long.ticket?.category], ["S".repeat(80), "Billing"]);
    assert.ok(long.ticket?.description.startsWith(`${"x".repeat(500)}\n\n`), "the summary was not cut to 500 characters");
  });

  await check("inbound recovery: a category renamed while Claude thinks is followed; one archived meanwhile leaves the ticket without one", async () => {
    const shippingId = await addCategory(owner, "Shipping");
    const renaming = fakeModel(answer({ customer_issue: "Parcel late.", ticket_subject: "Late parcel", category: "Shipping" }));
    const answerAfterRename = renaming.ask;
    renaming.ask = async (request) => {
      assert.deepEqual(await renameCategoryForSession(sessionFor(owner), { categoryId: shippingId, name: "Deliveries" }), { ok: true });
      return answerAfterRename(request);
    };
    const renamed = await receiveAndProcess(owner, "renamed", resendContent("renamed"), renaming.ask);
    assert.deepEqual([renamed.outcome, renamed.ticket?.category], ["ticketed", "Deliveries"]);
    const returnsId = await addCategory(owner, "Returns");
    const archiving = fakeModel(answer({ customer_issue: "Wants to return it.", ticket_subject: "Return", category: "Returns" }));
    const answerAfterArchive = archiving.ask;
    archiving.ask = async (request) => {
      assert.deepEqual(await setCategoryArchivedForSession(sessionFor(owner), { categoryId: returnsId, archived: "true" }), { ok: true });
      return answerAfterArchive(request);
    };
    const archived = await receiveAndProcess(owner, "archived", resendContent("archived"), archiving.ask);
    assert.deepEqual([archived.outcome, archived.ticket?.category, archived.ticket?.subject], ["ticketed", null, "Return"]);
  });

  await check("inbound recovery: a run cut off mid-way is claimed again after 15 minutes, never while it may still run, never by another company", async () => {
    const id = await receiveEmailRow(owner, "stale");
    await db.update(inboundEmails).set({ status: "processing", processingStartedAt: new Date() }).where(eq(inboundEmails.id, id));
    const options = { fetchEmail: async () => resendContent("stale"), askModel: plainTriageModel() };
    assert.equal(await processInboundEmail(owner.companyId, id, options), "not-claimed");
    await db.update(inboundEmails).set({ processingStartedAt: new Date(Date.now() - 16 * 60 * 1000) }).where(eq(inboundEmails.id, id));
    assert.equal(await processInboundEmail(otherOwner.companyId, id, options), "not-claimed");
    assert.equal(await processInboundEmail(owner.companyId, id, options), "ticketed");
    assert.equal((await inboundRow(id)).status, "ticketed");
  });

  await check("inbound recovery: a late run never overwrites what another run decided", async () => {
    const ticketed = await receiveAndProcess(owner, "decided", resendContent("decided"));
    await markInboundEmailIgnored(owner.companyId, ticketed.id, "processing_error", null);
    assert.equal((await inboundRow(ticketed.id)).status, "ticketed");
    const skipped = await receiveAndProcess(owner, "skipped", resendContent("skipped", { headers: { "Auto-Submitted": "auto-replied" } }));
    await markInboundEmailIgnored(owner.companyId, skipped.id, "content_unavailable", null);
    assert.equal((await inboundRow(skipped.id)).ignoredReason, "auto_reply");
  });

  await check("inbound recovery: control characters in From (a NUL can't be stored) never stop an email from being a ticket or listed", async () => {
    const ticketed = await receiveAndProcess(owner, "nul-from", resendContent("nul-from", { from: "bad\u0000sender", headers: {} }));
    assert.deepEqual([ticketed.outcome, ticketed.row.fromAddress, ticketed.ticket?.customerEmail], ["ticketed", "bad sender", null]);
    const skipped = resendContent("nul-skipped", { from: "kim\u0000lee\r\n", headers: { "Auto-Submitted": "auto-replied" } });
    const ignored = await receiveAndProcess(owner, "nul-skipped", skipped);
    assert.deepEqual([ignored.outcome, ignored.row.ignoredReason, ignored.row.fromAddress], ["ignored", "auto_reply", "kim lee"]);
  });

  await check("inbound recovery: a From too long to read whole is never verified, whichever field carries it", async () => {
    const victim = `victim-${runId}@bank.example`;
    const hidden = `attacker@evil.example${" ".repeat(2_100)}<${victim}>`;
    const inField = await receiveAndProcess(owner, "long-from-field", resendContent("long-from-field", { from: hidden, headers: {} }));
    const inHeader = await receiveAndProcess(owner, "long-from-header", resendContent("long-from-header", { from: victim, headers: { from: hidden } }));
    for (const { outcome, row, ticket } of [inField, inHeader]) {
      assert.deepEqual([outcome, row.senderVerified, ticket?.customerEmail, row.fromAddress], ["ticketed", false, null, victim]);
    }
  });

  await check("inbound recovery: the database refuses 'processing' without a start time", async () => {
    const id = await receiveEmailRow(owner, "no-start");
    await assertRefusedByConstraint(
      db.update(inboundEmails).set({ status: "processing", processingStartedAt: null }).where(eq(inboundEmails.id, id)),
      "inbound_emails_processing_has_start_time",
    );
  });
}
