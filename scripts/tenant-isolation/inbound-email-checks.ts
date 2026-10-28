// Email channel checks (step 15): only signed Resend webhooks are accepted,
// the company's forwarding address decides the company (step 24, more in
// forwarding-checks.ts), auto-replies, bulk mail, bounces, loops and floods
// never become tickets, the original is encrypted, and no address, subject or
// body is ever logged. FAKE fetcher and model only.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createInboundAddress } from "@/db/inbound-emails";
import { companies, inboundEmails, tickets } from "@/db/schema";
import type { InboundEmailContent } from "@/lib/inbound-email";
import { env } from "@/lib/env";
import { getInboundEmailDomain } from "@/lib/forwarding-address";
import { signLikeResend } from "@/lib/resend-webhook";
import { getSendingAddress } from "@/lib/send-email";
import { processInboundEmail } from "@/services/inbound-email-processing";
import { getOriginalEmailForSession } from "@/services/inbound-emails";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";
import { forwardingAddressOf, postToResendWebhook, receivedEventBody, signedLikeResend, storedInboundEmail } from "./resend-helpers";

const secret = env.RESEND_WEBHOOK_SECRET ?? "";
// Company A's own support address, as an owner would list it on Setup.
const supportAddress = `support-${runId}@acme.test`;
const sender = `sam-${runId}@customer.test`;

export async function runInboundEmailChecks(ownerA: TestUser, ownerB: TestUser) {
  const forwardingA = await forwardingAddressOf(ownerA);
  await createInboundAddress(ownerA.companyId, supportAddress);
  const tasks: string[] = [];
  const receivedEvent = (emailId: string, to = forwardingA) => receivedEventBody(emailId, { to: [to] });
  const post = (body: Buffer, headers: Record<string, string>) => postToResendWebhook(body, headers, tasks);
  const postEmail = (emailId: string) => post(receivedEvent(emailId), signedLikeResend(receivedEvent(emailId)));
  // Resend's shape: `from` is the bare address, the display name is only in
  // headers.from (webhooks-files/12: the name must come from there).
  const email = (overrides: Partial<InboundEmailContent> = {}): InboundEmailContent => ({
    from: sender,
    to: [forwardingA],
    subject: `Order missing ${runId}`,
    text: `My order never came. secret-body-${runId}`,
    headers: { from: `Sam Okafor <${sender}>` },
    // A verified sender (sender-authentication-checks.ts covers the others).
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    ...overrides,
  });

  await check("inbound: unsigned, wrongly signed, tampered and stale webhooks get 401 and save nothing", async () => {
    const id = `bad-${runId}`;
    const body = receivedEvent(id);
    const attempts = [
      await post(body, {}),
      await post(body, signLikeResend(body, "msg_x", new Date(), `whsec_${Buffer.from("wrong secret value").toString("base64")}`)),
      await post(receivedEvent(`${id}-other`), signedLikeResend(body)),
      await post(body, signedLikeResend(body, new Date(Date.now() - 6 * 60 * 1000))),
    ];
    for (const attempt of attempts) {
      assert.equal(attempt.result, 401);
      assert.deepEqual(attempt.logs, ["Resend webhook rejected: invalid signature"]);
    }
    assert.equal(await storedInboundEmail(id), undefined);
    assert.equal(tasks.length, 0);
    assert.ok(secret.startsWith("whsec_"), "the checks need RESEND_WEBHOOK_SECRET");
  });

  await check("inbound: the forwarding address decides the company; unknown addresses and repeats are ignored", async () => {
    const id = `ok-${runId}`;
    assert.equal((await postEmail(id)).result, 200);
    assert.equal((await storedInboundEmail(id)).companyId, ownerA.companyId);
    assert.equal((await postEmail(id)).result, 200);
    const unknown = `unknown-${runId}`;
    const unknownBody = receivedEvent(unknown, `c-${randomUUID().replaceAll("-", "")}@${getInboundEmailDomain()}`);
    const unknownPost = await post(unknownBody, signedLikeResend(unknownBody));
    assert.equal(unknownPost.result, 200);
    assert.deepEqual(unknownPost.logs, ["Inbound email ignored: no forwarding address"]);
    assert.equal(await storedInboundEmail(unknown), undefined);
    assert.equal(tasks.length, 1, "processing should be scheduled once, for the known address only");
  });

  await check("inbound: an email becomes a routed ticket for the sender; the original is encrypted and company-only", async () => {
    const id = `ticket-${runId}`;
    await postEmail(id);
    const row = await storedInboundEmail(id);
    const model = fakeModel(answer({ customer_issue: "Order never arrived.", ticket_subject: "Missing order", category: "" }));
    const { result, logs } = await captureConsole(() => processInboundEmail(ownerA.companyId, row.id, { fetchEmail: async () => email(), askModel: model.ask }));
    assert.equal(result, "ticketed");
    for (const secretText of [sender, `secret-body-${runId}`, `Order missing ${runId}`]) {
      assert.ok(logs.every((line) => !line.includes(secretText)), `logged: ${secretText}`);
      assert.ok(!model.prompts[0].includes(sender), "the sender's address was sent to Claude");
    }
    const stored = await storedInboundEmail(id);
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
    await postEmail(id);
    await processInboundEmail(ownerA.companyId, (await storedInboundEmail(id)).id, { fetchEmail: async () => email(), askModel: fakeModel(answer({ nonsense: true })).ask });
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, (await storedInboundEmail(id)).ticketId!));
    assert.equal(ticket.subject, `Order missing ${runId}`);
    assert.equal(ticket.category, null);
  });

  await check("inbound: auto-replies, bulk mail, bounces, the company's support addresses and ansa's own addresses never become tickets on their own", async () => {
    const cases: [string, Partial<InboundEmailContent>, string][] = [
      ["auto", { headers: { "Auto-Submitted": "auto-replied" } }, "auto_reply"],
      ["bulk", { headers: { Precedence: "bulk" } }, "bulk"],
      ["bounce", { from: "MAILER-DAEMON@mail.test" }, "bounce"],
      ["loop", { from: supportAddress }, "support_address"],
      ["forwarding-loop", { from: forwardingA }, "own_address"],
      ["sending-address", { from: `"ansa" <${getSendingAddress().toUpperCase()}>` }, "own_address"],
    ];
    for (const [label, overrides, reason] of cases) {
      const id = `ignore-${label}-${runId}`;
      await postEmail(id);
      const outcome = await processInboundEmail(ownerA.companyId, (await storedInboundEmail(id)).id, { fetchEmail: async () => email(overrides), askModel: fakeModel(answer({})).ask });
      assert.equal(outcome, "ignored", label);
      const row = await storedInboundEmail(id);
      assert.equal(row.ignoredReason, reason, label);
      assert.equal(row.ticketId, null);
    }
  });

  await check("inbound: one sender can't flood a company with tickets", async () => {
    const flooder = `flood-${runId}@customer.test`;
    const outcomes: string[] = [];
    for (let index = 0; index < 11; index++) {
      const id = `flood-${index}-${runId}`;
      await postEmail(id);
      outcomes.push(await processInboundEmail(ownerA.companyId, (await storedInboundEmail(id)).id, { fetchEmail: async () => email({ from: flooder }), askModel: fakeModel(answer({})).ask }));
    }
    assert.equal(outcomes.filter((outcome) => outcome === "ticketed").length, 10);
    assert.equal(outcomes.at(-1), "ignored");
  });

  await check("inbound: the database refuses 'ticketed' without a ticket", async () => {
    const id = `constraint-${runId}`;
    await postEmail(id);
    await assertRefusedByConstraint(
      db.update(inboundEmails).set({ status: "ticketed" }).where(eq(inboundEmails.resendEmailId, id)),
      "inbound_emails_ticket_matches_status",
    );
    assert.ok((await db.select().from(companies).where(eq(companies.id, ownerA.companyId))).length === 1);
  });
}
