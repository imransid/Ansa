// Going-live checks (step 17): errors are logged without their messages, the
// daily cleanup needs its secret and deletes only stale rows, and signed Resend
// bounce and spam reports land on the right company's sent email only.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { outgoingEmails, rateLimits, verifications } from "@/db/schema";
import { env } from "@/lib/env";
import { signLikeResend } from "@/lib/resend-webhook";
import { describeErrorSafely, installSafeErrorLogging } from "@/lib/safe-error-logging";
import { getLatestCustomerEmailForSession } from "@/services/customer-emails";
import { handleResendWebhook } from "@/services/inbound-email-webhook";
import { handleCleanupRequest } from "@/services/maintenance";
import { createTicketForCompany, markTicketSolvedForSession } from "@/services/tickets";
import { captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

const secretText = `+1555${runId}`;

function databaseLikeError(): Error {
  const postgresError = Object.assign(new Error(`duplicate key ${secretText}`), { code: "23505", constraint: "tickets_call_id_unique" });
  return new Error(`Failed query: insert into tickets params: ${secretText}`, { cause: postgresError });
}

// Solves a new ticket of one company and pretends Resend sent its email with this id.
async function sentEmailWithResendId(user: TestUser, resendId: string): Promise<string> {
  const ticket = await createTicketForCompany(user.companyId, { subject: "Bounce check", description: "x", channel: "email", customerEmail: `bounce-${runId}@example.test` });
  await markTicketSolvedForSession(sessionFor(user), { ticketId: ticket.id });
  await db.update(outgoingEmails).set({ providerMessageId: resendId }).where(eq(outgoingEmails.ticketId, ticket.id));
  return ticket.id;
}

async function postResendEvent(type: string, emailId: string, signed = true) {
  const body = Buffer.from(JSON.stringify({ type, data: { email_id: emailId } }));
  const headers = signed ? signLikeResend(body, `msg_${randomUUID()}`, new Date(), env.RESEND_WEBHOOK_SECRET ?? "") : {};
  const request = new Request("http://localhost/api/webhooks/resend", { method: "POST", headers, body: new Uint8Array(body) });
  return (await handleResendWebhook(request, () => {})).status;
}

export async function runOpsChecks(ownerA: TestUser, ownerB: TestUser) {
  await check("errors: logs keep the class, Postgres code and constraint, never the message", async () => {
    const description = describeErrorSafely(databaseLikeError());
    assert.equal(description, "Error <- Error (code 23505, constraint tickets_call_id_unique)");
    const lines: string[] = [];
    const fakeConsole = { error: (...args: unknown[]) => lines.push(args.join(" ")), warn: (...args: unknown[]) => lines.push(args.join(" ")) };
    installSafeErrorLogging(fakeConsole);
    fakeConsole.error("Request failed:", databaseLikeError());
    fakeConsole.warn(Object.assign(new Error("x"), { code: `not a code ${secretText}` }));
    assert.ok(lines.length === 2 && lines.every((line) => !line.includes(secretText)), lines.join("\n"));
    assert.ok(lines[0].startsWith("Request failed: Error <- Error (code 23505") && lines[0].includes("at "));
  });

  await check("cleanup: off without a secret, refused with a wrong one, and deletes only stale rows", async () => {
    const secret = `cron-secret-${runId}-${randomUUID()}`;
    // "" stands for "CRON_SECRET not set" (undefined would fall back to the real setting).
    const call = (authorization?: string, cronSecret = secret) =>
      handleCleanupRequest(new Request("http://localhost/api/cron/cleanup", { headers: authorization ? { authorization } : {} }), cronSecret);
    assert.equal((await call(`Bearer ${secret}`, "")).status, 404);
    const refused = await captureConsole(async () => [(await call()).status, (await call(`Bearer ${secret}x`)).status, (await call(secret)).status]);
    assert.deepEqual(refused.result, [401, 401, 401]);
    assert.ok(refused.logs.every((line) => line === "Cleanup rejected: invalid secret"));

    const staleKey = `stale-${runId}`;
    const liveKey = `live-${runId}`;
    await db.insert(rateLimits).values([
      { key: staleKey, attemptCount: 3, windowStartedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      { key: liveKey, attemptCount: 3, windowStartedAt: new Date() },
    ]);
    const expiredId = `expired-${runId}`;
    await db.insert(verifications).values({ id: expiredId, identifier: `x-${runId}`, value: "x", expiresAt: new Date(Date.now() - 1000) });
    const answer = await call(`Bearer ${secret}`);
    assert.equal(answer.status, 200);
    const counts = await answer.json();
    assert.ok(counts.rateLimitCounters >= 1 && counts.verifications >= 1, JSON.stringify(counts));
    assert.equal((await db.select().from(rateLimits).where(eq(rateLimits.key, staleKey))).length, 0);
    assert.equal((await db.select().from(rateLimits).where(eq(rateLimits.key, liveKey))).length, 1);
    assert.equal((await db.select().from(verifications).where(eq(verifications.id, expiredId))).length, 0);
    await db.delete(rateLimits).where(eq(rateLimits.key, liveKey));
  });

  await check("bounces: a signed bounce or spam report marks only that company's sent email", async () => {
    const ticketA = await sentEmailWithResendId(ownerA, `re-a-${runId}`);
    const ticketB = await sentEmailWithResendId(ownerB, `re-b-${runId}`);
    const problemOf = async (user: TestUser, ticketId: string) => (await getLatestCustomerEmailForSession(sessionFor(user), ticketId))?.deliveryProblem;

    assert.equal((await captureConsole(() => postResendEvent("email.bounced", `re-a-${runId}`, false))).result, 401);
    assert.equal(await problemOf(ownerA, ticketA), null);
    assert.equal(await postResendEvent("email.bounced", `re-a-${runId}`), 200);
    assert.equal(await postResendEvent("email.complained", `re-a-${runId}`), 200);
    assert.equal(await problemOf(ownerA, ticketA), "bounced", "the first problem reported should stay");
    assert.equal(await problemOf(ownerB, ticketB), null);
    assert.equal(await postResendEvent("email.complained", `re-b-${runId}`), 200);
    assert.equal(await problemOf(ownerB, ticketB), "complained");
    assert.equal(await postResendEvent("email.bounced", `re-unknown-${runId}`), 200);
    assert.equal(await postResendEvent("email.delivered", `re-a-${runId}`), 200);
  });
}
