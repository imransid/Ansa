// Step 27, customer emails that never arrived: Resend's email.suppressed and
// email.failed events mark the sent email as not delivered (like a bounce),
// and the Emails page and dashboard list every undelivered "solved" email of
// the company (failed, never sent, cut off, bounced, suppressed or failed at
// Resend), only for each ticket's current solve, and only for that company.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { outgoingEmails } from "@/db/schema";
import { lastDeliveryProblemFor } from "@/lib/last-delivery-problem";
import { getLatestCustomerEmailForSession } from "@/services/customer-emails";
import { markTicketSolvedForSession, reopenTicketForSession } from "@/services/ticket-status";
import { createTicketForCompany } from "@/services/tickets";
import { countUndeliveredCustomerEmailsForSession, listUndeliveredCustomerEmailsForSession } from "@/services/undelivered-emails";
import { check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { postToResendWebhook, signedLikeResend } from "./resend-helpers";

// Solves a new ticket of the user's company. Its "solved" email goes to the
// dev outbox ("sent"). Returns the ticket, its customer's address and the email row.
async function solvedTicketEmail(user: TestUser, label: string) {
  const customerEmail = `${label}-${runId}@example.test`;
  const ticket = await createTicketForCompany(user.companyId, { subject: label, description: "x", channel: "email", customerEmail });
  assert.equal((await markTicketSolvedForSession(sessionFor(user), { ticketId: ticket.id, confirmedCustomerEmail: customerEmail })).ok, true);
  const [email] = await db.select().from(outgoingEmails).where(eq(outgoingEmails.ticketId, ticket.id));
  return { ticketId: ticket.id, customerEmail, emailId: email.id };
}

function changeEmail(emailId: string, changes: Partial<typeof outgoingEmails.$inferInsert>) {
  return db.update(outgoingEmails).set(changes).where(eq(outgoingEmails.id, emailId));
}

async function postDeliveryEvent(type: string, resendEmailId: string): Promise<number> {
  const body = Buffer.from(JSON.stringify({ type, data: { email_id: resendEmailId } }));
  return (await postToResendWebhook(body, signedLikeResend(body))).result;
}

export async function runUndeliveredEmailChecks() {
  const owner = await signUpTestOwner("undelivered");
  const other = await signUpTestOwner("undelivered-other");
  const asOwner = sessionFor(owner);

  await check("delivery events: email.suppressed and email.failed mark the sent email as not delivered, for its company only", async () => {
    const suppressed = await solvedTicketEmail(owner, "suppressed");
    const failedAtResend = await solvedTicketEmail(owner, "failed-at-resend");
    await changeEmail(suppressed.emailId, { providerMessageId: `re-sup-${runId}` });
    await changeEmail(failedAtResend.emailId, { providerMessageId: `re-fail-${runId}` });
    assert.equal(await postDeliveryEvent("email.suppressed", `re-sup-${runId}`), 200);
    assert.equal(await postDeliveryEvent("email.failed", `re-fail-${runId}`), 200);
    const latestSuppressed = await getLatestCustomerEmailForSession(asOwner, suppressed.ticketId);
    assert.equal(latestSuppressed?.deliveryProblem, "suppressed");
    assert.equal((await getLatestCustomerEmailForSession(asOwner, failedAtResend.ticketId))?.deliveryProblem, "failed");
    assert.equal(await getLatestCustomerEmailForSession(sessionFor(other), suppressed.ticketId), null);
    // After a reopen, the open ticket warns before the next solve to that address.
    assert.equal(lastDeliveryProblemFor(suppressed.customerEmail, latestSuppressed ?? null), "suppressed");
  });

  await check("undelivered emails: failed, cut off, held back, bounced or suppressed are listed; delivered, in progress and earlier solves are not", async () => {
    const failedSend = await solvedTicketEmail(owner, "failed-send");
    await changeEmail(failedSend.emailId, { status: "failed" });
    const cutOff = await solvedTicketEmail(owner, "cut-off");
    await changeEmail(cutOff.emailId, { status: "sending", lastAttemptAt: new Date(Date.now() - 20 * 60 * 1000) });
    const heldBack = await solvedTicketEmail(owner, "held-back");
    await changeEmail(heldBack.emailId, { status: "pending", lastError: "daily_limit" });
    const bounced = await solvedTicketEmail(owner, "bounced");
    await changeEmail(bounced.emailId, { deliveryProblem: "bounced" });
    const delivered = await solvedTicketEmail(owner, "delivered");
    const complained = await solvedTicketEmail(owner, "complained");
    await changeEmail(complained.emailId, { deliveryProblem: "complained" });
    const inProgress = await solvedTicketEmail(owner, "in-progress");
    await changeEmail(inProgress.emailId, { status: "pending", lastError: null });
    const reopened = await solvedTicketEmail(owner, "reopened");
    await changeEmail(reopened.emailId, { status: "failed" });
    assert.equal((await reopenTicketForSession(asOwner, { ticketId: reopened.ticketId })).ok, true);

    const listed = await listUndeliveredCustomerEmailsForSession(asOwner);
    const listedIds = listed.map((email) => email.emailId);
    for (const email of [failedSend, cutOff, heldBack, bounced]) {
      assert.ok(listedIds.includes(email.emailId), `not listed: ${email.customerEmail}`);
    }
    for (const email of [delivered, complained, inProgress, reopened]) {
      assert.ok(!listedIds.includes(email.emailId), `listed: ${email.customerEmail}`);
    }
    assert.equal(listed.find((email) => email.emailId === heldBack.emailId)?.heldBackByDailyLimit, true);
    assert.equal(await countUndeliveredCustomerEmailsForSession(asOwner), listed.length);
    assert.deepEqual(await listUndeliveredCustomerEmailsForSession(sessionFor(other)), []);
    assert.equal(await countUndeliveredCustomerEmailsForSession(sessionFor(other)), 0);
  });
}
