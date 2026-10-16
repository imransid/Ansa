// Email channel checks (step 15): only signed Resend webhooks are accepted,
// the address an email was sent to decides the company, auto-replies, bulk mail,
// bounces, loops and floods never become tickets, the original is encrypted,
// and no address, subject or body is ever logged. FAKE fetcher and model only.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createInboundAddress } from "@/db/inbound-emails";
import { companies, inboundEmails, tickets } from "@/db/schema";
import type { InboundEmailContent } from "@/adapters/inbound-email";
import { env } from "@/lib/env";
import { signLikeResend } from "@/lib/resend-webhook";
import { processInboundEmail } from "@/services/inbound-email-processing";
import { handleResendWebhook } from "@/services/inbound-email-webhook";
import { getOriginalEmailForSession } from "@/services/inbound-emails";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

const secret = env.RESEND_WEBHOOK_SECRET ?? "";
const address = `support-${runId}@inbound.test`;
const sender = `sam-${runId}@customer.test`;

function receivedEvent(emailId: string, to = address) {
  return Buffer.from(JSON.stringify({ type: "email.received", data: { email_id: emailId, to: [to], from: sender, subject: "x" } }));
}

async function post(body: Buffer, headers: Record<string, string>, tasks: string[]) {
  const request = new Request("http://localhost/api/webhooks/resend", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: new Uint8Array(body) });
  return captureConsole(async () => (await handleResendWebhook(request, () => { tasks.push("process"); })).status);
}

const signed = (body: Buffer, at = new Date()) => signLikeResend(body, `msg_${randomUUID()}`, at, secret);

function email(overrides: Partial<InboundEmailContent> = {}): InboundEmailContent {
  return { from: `Sam Okafor <${sender}>`, to: [address], subject: `Order missing ${runId}`, text: `My order never came. secret-body-${runId}`, headers: {}, ...overrides };
}

async function storedRow(resendEmailId: string) {
  return (await db.select().from(inboundEmails).where(eq(inboundEmails.resendEmailId, resendEmailId)))[0];
}

export async function runInboundEmailChecks(ownerA: TestUser, ownerB: TestUser) {
  await createInboundAddress(ownerA.companyId, address);
  const tasks: string[] = [];

  await check("inbound: unsigned, wrongly signed, tampered and stale webhooks get 401 and save nothing", async () => {
    const id = `bad-${runId}`;
    const body = receivedEvent(id);
    const attempts = [
      await post(body, {}, tasks),
      await post(body, signLikeResend(body, "msg_x", new Date(), `whsec_${Buffer.from("wrong secret value").toString("base64")}`), tasks),
      await post(receivedEvent(`${id}-other`), signed(body), tasks),
      await post(body, signed(body, new Date(Date.now() - 6 * 60 * 1000)), tasks),
    ];
    for (const attempt of attempts) {
      assert.equal(attempt.result, 401);
      assert.deepEqual(attempt.logs, ["Resend webhook rejected: invalid signature"]);
    }
    assert.equal(await storedRow(id), undefined);
    assert.equal(tasks.length, 0);
  });

  await check("inbound: the recipient address decides the company; unknown addresses and repeats are ignored", async () => {
    const id = `ok-${runId}`;
    assert.equal((await post(receivedEvent(id), signed(receivedEvent(id)), tasks)).result, 200);
    assert.equal((await storedRow(id)).companyId, ownerA.companyId);
    assert.equal((await post(receivedEvent(id), signed(receivedEvent(id)), tasks)).result, 200);
    const unknown = `unknown-${runId}`;
    const unknownBody = receivedEvent(unknown, `nobody-${runId}@inbound.test`);
    assert.equal((await post(unknownBody, signed(unknownBody), tasks)).result, 200);
    assert.equal(await storedRow(unknown), undefined);
    assert.equal(tasks.length, 1, "processing should be scheduled once, for the known address only");
  });

  await check("inbound: an email becomes a routed ticket for the sender; the original is encrypted and company-only", async () => {
    const id = `ticket-${runId}`;
    await post(receivedEvent(id), signed(receivedEvent(id)), tasks);
    const row = await storedRow(id);
    const model = fakeModel(answer({ customer_issue: "Order never arrived.", ticket_subject: "Missing order", category: "" }));
    const { result, logs } = await captureConsole(() => processInboundEmail(ownerA.companyId, row.id, { fetchEmail: async () => email(), askModel: model.ask }));
    assert.equal(result, "ticketed");
    for (const secretText of [sender, `secret-body-${runId}`, `Order missing ${runId}`]) {
      assert.ok(logs.every((line) => !line.includes(secretText)), `logged: ${secretText}`);
      assert.ok(!model.prompts[0].includes(sender), "the sender's address was sent to Claude");
    }
    const stored = await storedRow(id);
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, stored.ticketId!));
    assert.equal(ticket.channel, "email");
    assert.equal(ticket.customerEmail, sender);
    assert.equal(ticket.customerName, "Sam Okafor");
    assert.equal(ticket.subject, "Missing order");
    assert.ok(!ticket.description.includes(`secret-body-${runId}`), "the email body was copied onto the ticket");
    assert.ok(stored.bodyEncrypted?.startsWith("v1:") && !JSON.stringify(stored).includes(`secret-body-${runId}`));
    const original = await getOriginalEmailForSession(sessionFor(ownerA), ticket.id);
    assert.ok(original?.body?.includes(`secret-body-${runId}`));
    assert.equal(await getOriginalEmailForSession(sessionFor(ownerB), ticket.id), null);
  });

  await check("inbound: a bad Claude answer still makes a ticket, with the email's own subject", async () => {
    const id = `fallback-${runId}`;
    await post(receivedEvent(id), signed(receivedEvent(id)), tasks);
    await processInboundEmail(ownerA.companyId, (await storedRow(id)).id, { fetchEmail: async () => email(), askModel: fakeModel(answer({ nonsense: true })).ask });
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, (await storedRow(id)).ticketId!));
    assert.equal(ticket.subject, `Order missing ${runId}`);
    assert.equal(ticket.category, null);
  });

  await check("inbound: auto-replies, bulk mail, bounces and our own addresses never become tickets", async () => {
    const cases: [string, Partial<InboundEmailContent>, string][] = [
      ["auto", { headers: { "Auto-Submitted": "auto-replied" } }, "auto_reply"],
      ["bulk", { headers: { Precedence: "bulk" } }, "bulk"],
      ["bounce", { from: "MAILER-DAEMON@mail.test" }, "bounce"],
      ["loop", { from: address }, "own_address"],
    ];
    for (const [label, overrides, reason] of cases) {
      const id = `ignore-${label}-${runId}`;
      await post(receivedEvent(id), signed(receivedEvent(id)), tasks);
      const outcome = await processInboundEmail(ownerA.companyId, (await storedRow(id)).id, { fetchEmail: async () => email(overrides), askModel: fakeModel(answer({})).ask });
      assert.equal(outcome, "ignored", label);
      const row = await storedRow(id);
      assert.equal(row.ignoredReason, reason);
      assert.equal(row.ticketId, null);
    }
  });

  await check("inbound: one sender can't flood a company with tickets", async () => {
    const flooder = `flood-${runId}@customer.test`;
    const outcomes: string[] = [];
    for (let index = 0; index < 11; index++) {
      const id = `flood-${index}-${runId}`;
      await post(receivedEvent(id), signed(receivedEvent(id)), tasks);
      outcomes.push(await processInboundEmail(ownerA.companyId, (await storedRow(id)).id, { fetchEmail: async () => email({ from: flooder }), askModel: fakeModel(answer({})).ask }));
    }
    assert.equal(outcomes.filter((outcome) => outcome === "ticketed").length, 10);
    assert.equal(outcomes.at(-1), "ignored");
  });

  await check("inbound: the database refuses 'ticketed' without a ticket", async () => {
    const id = `constraint-${runId}`;
    await post(receivedEvent(id), signed(receivedEvent(id)), tasks);
    await assertRefusedByConstraint(
      db.update(inboundEmails).set({ status: "ticketed" }).where(eq(inboundEmails.resendEmailId, id)),
      "inbound_emails_ticket_matches_status",
    );
    assert.ok((await db.select().from(companies).where(eq(companies.id, ownerA.companyId))).length === 1);
  });
}
