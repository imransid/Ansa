// Sender authentication checks (step 25): an email's sender becomes the
// ticket's customer email only when Resend reports a passing DKIM or DMARC
// check and From holds one address only. SPF alone, failures, unknown values,
// missing results and a second address in the sender's name leave the
// ticket without one and mark the sender "not verified" (only for the
// ticket's own company), and an expert can still use it after confirming.
// Resend's field is read with Zod, the dev stand-in included. Subjects the
// sender wrote lose hidden format characters, and card numbers before the
// length cap, on their way to a ticket or an assignment email.
// FAKE fetcher and model only: nothing here calls Resend or Claude.

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { fetchInboundEmail, type InboundEmailContent } from "@/lib/inbound-email";
import { db } from "@/db/client";
import { tickets } from "@/db/schema";
import { renderTicketAssignedEmail } from "@/lib/emails/ticket-assigned";
import { triageFromModelResult } from "@/lib/email-triage/result";
import { isRealEmailOn } from "@/lib/send-email";
import { receivedEmailAuthenticationSchema } from "@/lib/validation/resend";
import { processInboundEmail } from "@/services/inbound-email-processing";
import { getOriginalEmailForSession } from "@/services/inbound-emails";
import { setCustomerEmailForSession } from "@/services/tickets";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { check, runId, sessionFor, type TestUser } from "./helpers";
import { forwardingAddressOf, postReceivedEmail, storedInboundEmail } from "./resend-helpers";

const CARD = "4111 1111 1111 1111";

// Receives one email for the owner's company through the signed webhook and
// processes it with this content. Returns the stored email row and its ticket.
// writeFrom turns the sender's address into the From header.
async function receiveEmail(
  owner: TestUser,
  label: string,
  authentication: InboundEmailContent["authentication"],
  writeFrom = (address: string) => `Pat <${address}>`,
) {
  const resendId = `auth-${label}-${runId}`;
  const sender = `auth-${label}-${runId}@customer.test`;
  await postReceivedEmail(resendId, { to: [await forwardingAddressOf(owner)] });
  const content: InboundEmailContent = { from: writeFrom(sender), to: [], subject: "Order help", text: "Where is my order?", headers: {}, authentication };
  const model = fakeModel(answer({ customer_issue: "Order missing.", ticket_subject: "Missing order", category: "" }));
  assert.equal(await processInboundEmail(owner.companyId, (await storedInboundEmail(resendId)).id, { fetchEmail: async () => content, askModel: model.ask }), "ticketed");
  const row = await storedInboundEmail(resendId);
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, row.ticketId!));
  return { sender, row, ticket };
}

export async function runSenderAuthenticationChecks(ownerA: TestUser, ownerB: TestUser) {
  await check("sender auth: DKIM or DMARC pass makes the sender the customer email", async () => {
    for (const [label, authentication] of [
      ["dkim", { spf: "fail", dkim: "pass", dmarc: "gray" }],
      ["dmarc", { spf: "fail", dkim: "fail", dmarc: "pass" }],
    ] as const) {
      const { sender, row, ticket } = await receiveEmail(ownerA, label, authentication);
      assert.equal(ticket.customerEmail, sender, label);
      assert.equal(row.senderVerified, true, label);
    }
  });

  await check("sender auth: SPF alone, failures, unknown or missing results leave no customer email, sender shown not verified", async () => {
    const cases = [
      ["spf-only", { spf: "pass", dkim: "fail", dmarc: "fail" }],
      ["gray", { spf: "gray", dkim: "gray", dmarc: "gray" }],
      ["unknown", { spf: "unknown", dkim: "processing_failed", dmarc: "unknown" }],
      ["missing", null],
    ] as const;
    for (const [label, authentication] of cases) {
      const { sender, row, ticket } = await receiveEmail(ownerA, label, authentication);
      assert.equal(ticket.customerEmail, null, label);
      assert.equal(row.senderVerified, false, label);
      const original = await getOriginalEmailForSession(sessionFor(ownerA), ticket.id);
      assert.deepEqual([original?.fromAddress, original?.senderVerified], [sender, false], label);
      assert.equal(await getOriginalEmailForSession(sessionFor(ownerB), ticket.id), null, label);
    }
  });

  await check("sender auth: a second address in the sender's name means not verified, even with DKIM and DMARC passing", async () => {
    // Resend checks the From domain with its own parser, which may read the
    // address in the name; parseMailbox takes the one in <...>.
    const passed = { spf: "pass", dkim: "pass", dmarc: "pass" } as const;
    const cases = [
      ["name-is-other-address", (address: string) => `attacker@evil.test <${address}>`],
      ["quoted-other-address", (address: string) => `"attacker@evil.test" <${address}>`],
      ["name-is-same-address", (address: string) => `"${address}" <${address}>`],
    ] as const;
    for (const [label, writeFrom] of cases) {
      const { sender, row, ticket } = await receiveEmail(ownerA, label, passed, writeFrom);
      assert.equal(ticket.customerEmail, null, label);
      assert.equal(row.senderVerified, false, label);
      assert.equal(row.fromAddress, sender, `${label}: the ticket still shows the <address>, as not verified`);
    }
    // The same authentication with a plain From is verified.
    const { sender, ticket } = await receiveEmail(ownerA, "one-address", passed, (address) => address);
    assert.equal(ticket.customerEmail, sender);
  });

  await check("sender auth: an expert can still use an unverified sender, after confirming it", async () => {
    const { sender, ticket } = await receiveEmail(ownerA, "confirmed-later", { spf: "fail", dkim: "fail", dmarc: "fail" });
    assert.equal((await setCustomerEmailForSession(sessionFor(ownerB), { ticketId: ticket.id, customerEmail: sender, confirmed: "yes" })).ok, false);
    assert.deepEqual(await setCustomerEmailForSession(sessionFor(ownerA), { ticketId: ticket.id, customerEmail: sender, confirmed: "yes" }), { ok: true });
    const [updated] = await db.select().from(tickets).where(eq(tickets.id, ticket.id));
    assert.deepEqual([updated.customerEmail, updated.customerEmailSetByUserId], [sender, ownerA.id]);
  });

  await check("sender auth: Resend's field is read with Zod, also from the dev stand-in; odd values count as unknown", async () => {
    assert.equal(receivedEmailAuthenticationSchema.parse(undefined), null);
    assert.equal(receivedEmailAuthenticationSchema.parse("pass"), null);
    assert.deepEqual(receivedEmailAuthenticationSchema.parse({ dkim: { result: "pass" }, dmarc: "PASS" }), { spf: "unknown", dkim: "unknown", dmarc: "unknown" });
    // The content comes from Resend only with SEND_REAL_EMAIL=true, which the
    // runner refuses (local-only.ts): a RESEND_API_KEY alone never calls Resend.
    assert.equal(isRealEmailOn(), false, "the checks must never call Resend");
    const folder = path.join(process.cwd(), ".dev-inbound");
    await mkdir(folder, { recursive: true });
    const standIns = { passed: { spf: "pass", dkim: "pass", dmarc: "pass" }, missing: undefined, odd: { dkim: true } };
    try {
      for (const [label, authentication] of Object.entries(standIns)) {
        await writeFile(path.join(folder, `auth-${label}-${runId}.json`), JSON.stringify({ from: "a@b.test", to: [], subject: "x", authentication }));
      }
      assert.deepEqual((await fetchInboundEmail(`auth-passed-${runId}`))?.authentication, standIns.passed);
      assert.equal((await fetchInboundEmail(`auth-missing-${runId}`))?.authentication, null);
      assert.deepEqual((await fetchInboundEmail(`auth-odd-${runId}`))?.authentication, { spf: "unknown", dkim: "unknown", dmarc: "unknown" });
    } finally {
      for (const label of Object.keys(standIns)) {
        await rm(path.join(folder, `auth-${label}-${runId}.json`), { force: true });
      }
    }
  });

  await check("sender-written subjects: no hidden format characters, card numbers redacted before the 200-character cap", async () => {
    const rawSubject = `IT notice: renew at acme-sso.example \u202Egpj.exe\u200B\r\nBcc: x@evil.test card ${CARD}`;
    const triage = triageFromModelResult({ kind: "refused" }, rawSubject, []);
    assert.ok(!/[\u202E\u200B\r\n]/.test(triage.ticketSubject), triage.ticketSubject);
    assert.ok(!triage.ticketSubject.includes("4111") && triage.ticketSubject.includes("[number]"), triage.ticketSubject);
    // A card number cut in half by the cap must not survive as bare digits.
    const atTheCap = triageFromModelResult({ kind: "error", errorName: "APIError" }, `${"x".repeat(190)} ${CARD}`, []);
    assert.ok(atTheCap.ticketSubject.length <= 200 && !/\d{4}/.test(atTheCap.ticketSubject), atTheCap.ticketSubject);
    const assigned = renderTicketAssignedEmail({
      assigneeName: "Ana",
      ticketNumber: 57,
      ticketSubject: "Invoice \u202Egpj.exe\u2066\u200B\u2028Bcc: x@evil.test",
      category: null,
      assignedAutomatically: false,
      assigneeHandlesCategory: false,
      link: "http://localhost:3000/tickets/57",
    });
    assert.ok(!/[\u202E\u2066\u200B\u2028\r\n]/.test(assigned.subject), assigned.subject);
    assert.equal(assigned.subject, "Ticket #57 is yours: Invoice gpj.exe Bcc: x@evil.test");
  });
}
