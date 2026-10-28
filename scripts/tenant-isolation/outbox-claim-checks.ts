// Outbox checks (step 26): a delivery claims the email first (pending or
// failed -> sending in one update), so two deliveries at the same moment send
// it once; "failed" is only recorded over "sending" and "sent" never over
// "pending", so a late failure never undoes "sent"; failures are logged and
// stored as an error code, never a provider's message; Retry never starts
// while a delivery is on its way; and an email first tried more than 23 hours
// ago (past Resend's idempotency window) is only sent again once confirmed.
// FAKE senders only, apart from Retry itself, which writes to .dev-emails.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describeResendError } from "@/adapters/resend";
import { db } from "@/db/client";
import { claimEmailForDelivery, markEmailFailed, markEmailSent } from "@/db/outgoing-email-delivery";
import { outgoingEmails } from "@/db/schema";
import { markTicketSolvedAndQueueEmail } from "@/db/ticket-solving";
import { toDeliveryErrorCode } from "@/lib/delivery-error-code";
import type { FormResult } from "@/lib/form-result";
import type { EmailMessage, EmailSendResult } from "@/lib/send-email";
import { deliverOutgoingEmail, getLatestCustomerEmailForSession, retryCustomerEmailForSession } from "@/services/customer-emails";
import { createTicketForCompany } from "@/services/tickets";
import { captureConsole, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Solves a new email ticket and returns its queued "solved" email, not delivered yet.
async function queueSolvedEmail(owner: TestUser, label: string) {
  const customerEmail = `outbox-${label}-${runId}@example.test`;
  const ticket = await createTicketForCompany(owner.companyId, { subject: `Outbox ${label}`, description: "x", channel: "email", customerEmail });
  const { queuedEmailId } = await markTicketSolvedAndQueueEmail(owner.companyId, ticket.id, owner.id, customerEmail);
  assert.ok(queuedEmailId, "no email was queued");
  return { ticketId: ticket.id, emailId: queuedEmailId };
}

async function storedEmail(emailId: string) {
  return (await db.select().from(outgoingEmails).where(eq(outgoingEmails.id, emailId)))[0];
}

// A sender that takes a moment and counts what it was asked to send.
function slowFakeSender(sent: string[]) {
  return async (message: EmailMessage): Promise<EmailSendResult> => {
    sent.push(message.idempotencyKey);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { ok: true, providerMessageId: `fake-${randomUUID()}` };
  };
}

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

export async function runOutboxClaimChecks() {
  const owner = await signUpTestOwner("outbox");
  const session = sessionFor(owner);

  await check("outbox: of two deliveries of one email at the same moment, only the one that claims it sends", async () => {
    const { emailId } = await queueSolvedEmail(owner, "race");
    const sent: string[] = [];
    const outcomes = await Promise.all([
      deliverOutgoingEmail(owner.companyId, emailId, { send: slowFakeSender(sent) }),
      deliverOutgoingEmail(owner.companyId, emailId, { send: slowFakeSender(sent) }),
    ]);
    assert.deepEqual(outcomes.sort(), ["not-deliverable", "sent"]);
    assert.equal(sent.length, 1, "the email was sent twice");
    const row = await storedEmail(emailId);
    assert.deepEqual([row.status, row.attemptCount], ["sent", 1]);
  });

  await check("outbox: sent and failed are only recorded for a claimed email; a late failure never undoes 'sent', a late success still counts", async () => {
    const { emailId } = await queueSolvedEmail(owner, "late-failure");
    await markEmailSent(owner.companyId, emailId, "fake-unclaimed");
    await markEmailFailed(owner.companyId, emailId, "validation_error");
    assert.equal((await storedEmail(emailId)).status, "pending", "an unclaimed email changed");
    assert.equal(await deliverOutgoingEmail(owner.companyId, emailId, { send: slowFakeSender([]) }), "sent");
    // Resend refusing a second request with the same key, recorded after the first one succeeded.
    await markEmailFailed(owner.companyId, emailId, "concurrent_idempotent_requests");
    const row = await storedEmail(emailId);
    assert.deepEqual([row.status, row.lastError], ["sent", null]);

    // A delivery that outlived its claim: a newer try failed first, then the old one got through.
    const outlived = await queueSolvedEmail(owner, "late-success");
    assert.equal(await claimEmailForDelivery(owner.companyId, outlived.emailId, false), true);
    await markEmailFailed(owner.companyId, outlived.emailId, "concurrent_idempotent_requests");
    await markEmailSent(owner.companyId, outlived.emailId, "fake-late-success");
    assert.equal((await storedEmail(outlived.emailId)).status, "sent");
  });

  await check("outbox: a failure is logged and stored as an error code, never the provider's message", async () => {
    const accountAddress = `owner-${runId}@example.test`;
    const resendFailure = describeResendError({ name: "validation_error", message: `You can only send testing emails to your own email address (${accountAddress})` });
    const { emailId } = await queueSolvedEmail(owner, "failure-code");
    const failing = async (): Promise<EmailSendResult> => ({ ok: false, error: resendFailure });
    const { result, logs } = await captureConsole(() => deliverOutgoingEmail(owner.companyId, emailId, { send: failing }));
    assert.equal(result, "failed");
    assert.deepEqual(logs, ["Email delivery failed: validation_error"]);
    assert.equal((await storedEmail(emailId)).lastError, "validation_error");
    // A sender that throws leaves only the error's class name.
    const throwing = async (): Promise<EmailSendResult> => {
      throw new TypeError(`could not reach ${accountAddress}`);
    };
    const thrown = await captureConsole(() => deliverOutgoingEmail(owner.companyId, emailId, { send: throwing }));
    assert.ok(thrown.logs.every((line) => !line.includes(accountAddress)), thrown.logs.join("\n"));
    assert.equal((await storedEmail(emailId)).lastError, "TypeError");
    assert.deepEqual([toDeliveryErrorCode("EROFS"), toDeliveryErrorCode("no such file: /x"), toDeliveryErrorCode(undefined)], ["EROFS", "unknown_error", "unknown_error"]);
  });

  await check("outbox: no Retry while a delivery is on its way; an interrupted one (10+ minutes) can be retried", async () => {
    const { ticketId, emailId } = await queueSolvedEmail(owner, "interrupted");
    assert.equal((await getLatestCustomerEmailForSession(session, ticketId))?.deliveryInProgress, true, "a just-queued email waits for its own delivery");
    await db.update(outgoingEmails).set({ status: "sending", attemptCount: 1, firstAttemptAt: new Date(), lastAttemptAt: new Date() }).where(eq(outgoingEmails.id, emailId));
    assert.equal((await getLatestCustomerEmailForSession(session, ticketId))?.deliveryInProgress, true);
    assert.match(messageOf(await retryCustomerEmailForSession(session, { emailId })), /being sent right now/);
    assert.equal((await storedEmail(emailId)).attemptCount, 1);

    await db.update(outgoingEmails).set({ lastAttemptAt: new Date(Date.now() - 11 * MINUTE) }).where(eq(outgoingEmails.id, emailId));
    const interrupted = await getLatestCustomerEmailForSession(session, ticketId);
    assert.deepEqual([interrupted?.status, interrupted?.deliveryInProgress], ["sending", false]);
    assert.deepEqual(await retryCustomerEmailForSession(session, { emailId }), { ok: true });
    assert.deepEqual([(await storedEmail(emailId)).status, (await storedEmail(emailId)).attemptCount], ["sent", 2]);
  });

  await check("outbox: an email first tried more than 23 hours ago is only sent again once the person confirms", async () => {
    const { ticketId, emailId } = await queueSolvedEmail(owner, "old-first-try");
    const firstTry = new Date(Date.now() - 25 * HOUR);
    await db.update(outgoingEmails).set({ status: "failed", attemptCount: 1, firstAttemptAt: firstTry, lastAttemptAt: firstTry }).where(eq(outgoingEmails.id, emailId));
    assert.equal((await getLatestCustomerEmailForSession(session, ticketId))?.mayAlreadyHaveBeenDelivered, true);
    assert.match(messageOf(await retryCustomerEmailForSession(session, { emailId })), /may already have reached the customer/);
    // The claim refuses it too, so a delivery that skipped the read above still couldn't send.
    assert.equal(await claimEmailForDelivery(owner.companyId, emailId, false), false);
    assert.deepEqual([(await storedEmail(emailId)).status, (await storedEmail(emailId)).attemptCount], ["failed", 1]);
    assert.equal((await retryCustomerEmailForSession(session, { emailId, confirmPossibleDuplicate: "maybe" })).ok, false);

    assert.deepEqual(await retryCustomerEmailForSession(session, { emailId, confirmPossibleDuplicate: "yes" }), { ok: true });
    const row = await storedEmail(emailId);
    assert.deepEqual([row.status, row.attemptCount, row.firstAttemptAt?.getTime()], ["sent", 2, firstTry.getTime()]);

    // First tried 2 hours ago: Resend still recognises the key, so Retry just sends.
    const recent = await queueSolvedEmail(owner, "recent-first-try");
    const twoHoursAgo = new Date(Date.now() - 2 * HOUR);
    await db.update(outgoingEmails).set({ status: "failed", attemptCount: 1, firstAttemptAt: twoHoursAgo, lastAttemptAt: twoHoursAgo }).where(eq(outgoingEmails.id, recent.emailId));
    assert.equal((await getLatestCustomerEmailForSession(session, recent.ticketId))?.mayAlreadyHaveBeenDelivered, false);
    assert.deepEqual(await retryCustomerEmailForSession(session, { emailId: recent.emailId }), { ok: true });
  });

  await check("outbox: another company can't claim, send or retry the email", async () => {
    const other = await signUpTestOwner("outbox-other");
    const { emailId } = await queueSolvedEmail(owner, "other-company");
    assert.equal(await deliverOutgoingEmail(other.companyId, emailId, { send: slowFakeSender([]) }), "not-deliverable");
    assert.equal((await retryCustomerEmailForSession(sessionFor(other), { emailId })).ok, false);
    const row = await storedEmail(emailId);
    assert.deepEqual([row.status, row.attemptCount], ["pending", 0]);
  });
}
