// Customer email safety checks (step 25): the "solved" email is the same fixed
// text for everyone (no customer name, no ticket subject: on email tickets the
// sender wrote both), it always comes from "<Company> via ansa" with nothing
// in the name that could pose as an address (look-alikes and encoded-words
// included) or break the header, and one company can send at most 300
// customer emails a day without touching another company's emails. A held-back
// email is noted on its row (the ticket page says why) until it is sent.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { outgoingEmails, tickets } from "@/db/schema";
import type { FormResult } from "@/lib/form-result";
import { buildFromHeader, getSendingAddress } from "@/lib/send-email";
import { getLatestCustomerEmailForSession, retryCustomerEmailForSession } from "@/services/customer-emails";
import { isOverRateLimit, RATE_LIMITS, takeBackRateLimitAttempt } from "@/services/rate-limit";
import { closeTicketWithoutEmailForSession, markTicketSolvedForSession } from "@/services/ticket-status";
import { createTicketForCompany } from "@/services/tickets";
import { check, devOutboxPath, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

// The quoted sender name of a From header built by buildFromHeader.
function senderNameOf(fromHeader: string): string {
  return fromHeader.slice(1, fromHeader.lastIndexOf(`" <`));
}

// Creates an email ticket for this address, solves it (confirming the address
// as the page would) and returns the result with the queued email row.
async function solveEmailTicket(owner: TestUser, customerEmail: string) {
  const ticket = await createTicketForCompany(owner.companyId, { subject: "Cap check", description: "x", channel: "email", customerEmail });
  const result = await markTicketSolvedForSession(sessionFor(owner), { ticketId: ticket.id, confirmedCustomerEmail: customerEmail });
  const [email] = await db.select().from(outgoingEmails).where(eq(outgoingEmails.ticketId, ticket.id));
  return { ticketId: ticket.id, result, email };
}

export async function runCustomerEmailSafetyChecks() {
  await check("solved email: a fixed greeting and the request number, never the sender's name or the subject", async () => {
    const owner = await signUpTestOwner("solved-text");
    const customerEmail = `victim-${runId}@example.test`;
    // What a forged sender (or a refused triage, which keeps the raw subject) puts on a ticket.
    const ticket = await createTicketForCompany(owner.companyId, {
      subject: "Refund of $1,499 approved: claim at acme-refunds.example",
      description: "x",
      channel: "email",
      customerName: "Your Acme account is locked - verify at acme-login.example",
      customerEmail,
    });
    await markTicketSolvedForSession(sessionFor(owner), { ticketId: ticket.id, confirmedCustomerEmail: customerEmail });
    const sent = await getLatestCustomerEmailForSession(sessionFor(owner), ticket.id);
    const file = await readFile(devOutboxPath(sent?.providerMessageId ?? ""), "utf8");
    assert.ok(file.includes("Hello,"));
    assert.ok(file.includes(`your request #${ticket.ticketNumber} has been solved by the Isolation test solved-text ${runId} team`));
    assert.ok(file.includes(` via ansa&quot; &lt;${getSendingAddress()}&gt;`), "the From name is not \"<Company> via ansa\"");
    for (const senderText of ["acme-refunds.example", "acme-login.example", "1,499"]) {
      assert.ok(!file.includes(senderText), `the email contains "${senderText}"`);
    }
  });

  await check("From header: \"<Company> via ansa\" on our address, nothing that poses as an address or breaks the header", async () => {
    const address = getSendingAddress();
    assert.equal(buildFromHeader("Acme"), `"Acme via ansa" <${address}>`);
    const hostile = buildFromHeader('security@paypal.com "Billing" <x>\\ \r\nBcc: a@b.test \u202Egpj.exe\u200B');
    assert.ok(hostile.endsWith(` via ansa" <${address}>`), hostile);
    assert.ok(!/[@"<>\\\r\n\u202E\u200B]/.test(senderNameOf(hostile)), `left in the sender name: ${senderNameOf(hostile)}`);
    // Look-alikes (full-width \uFF20 \uFF1C \uFF1E \uFF02 \uFF3C, small \uFE6B) count as the real thing,
    // and no encoded-word ("=?UTF-8?Q?...?=", which some clients decode inside
    // the quotes) survives, not even with an invisible character or
    // full-width \uFF1D\uFF1F standing in for "=?".
    const lookAlikesAndEncodedWords = [
      "security\uFF20paypal.com",
      "PayPal \uFF1Cservice\uFE6Bpaypal.com\uFF1E \uFF02x\uFF02 \uFF3C",
      "=?UTF-8?Q?PayPal_=3Cservice=40paypal.com=3E?=",
      "=?UTF-8?B?c2VjdXJpdHlAcGF5cGFsLmNvbQ==?=",
      "=\u200B?UTF-8?B?c2VjdXJpdHlAcGF5cGFsLmNvbQ==?\u200B=",
      "\uFF1D\uFF1FUTF-8?Q?x=40y?\uFF1D",
    ];
    for (const name of lookAlikesAndEncodedWords) {
      const senderName = senderNameOf(buildFromHeader(name));
      assert.ok(!/[@"<>\\\uFF20\uFE6B\uFF1C\uFF1E\uFF02\uFF3C]|=\?|\?=/.test(senderName), `left in the sender name: ${senderName}`);
    }
    assert.equal(buildFromHeader("security\uFF20paypal.com"), `"security paypal.com via ansa" <${address}>`);
    // A long name is cut, never the " via ansa" that shows who really sent it.
    assert.ok(buildFromHeader("A".repeat(100)).endsWith(` via ansa" <${address}>`));
    // A name made only of removed characters leaves our own name.
    assert.equal(buildFromHeader("@@ \u202E"), `"ansa" <${address}>`);
  });

  await check("daily cap: a company's 301st customer email of the day is held back and noted, Retry says why, other companies still send", async () => {
    const capped = await signUpTestOwner("email-cap");
    const rule = RATE_LIMITS.customerEmailsPerCompany;
    // Use up all but one of today's emails, as 299 solves would have.
    for (let sent = 1; sent < rule.maxAttempts; sent++) {
      await isOverRateLimit("customer-emails", capped.companyId, rule);
    }
    const lastOne = await solveEmailTicket(capped, `cap-300-${runId}@example.test`);
    assert.deepEqual(lastOne.result, { ok: true });
    assert.equal(lastOne.email.status, "sent");

    // The solve itself worked: the ticket page's email line (not a message
    // that would outlive a later Retry) says why the email waits.
    const heldBack = await solveEmailTicket(capped, `cap-301-${runId}@example.test`);
    assert.deepEqual(heldBack.result, { ok: true });
    assert.equal((await db.select().from(tickets).where(eq(tickets.id, heldBack.ticketId)))[0].status, "solved");
    assert.equal(heldBack.email.status, "pending", "the held-back email must wait as 'not sent yet'");
    const onPage = () => getLatestCustomerEmailForSession(sessionFor(capped), heldBack.ticketId);
    assert.equal((await onPage())?.heldBackByDailyLimit, true);
    assert.match(messageOf(await retryCustomerEmailForSession(sessionFor(capped), { emailId: heldBack.email.id })), /Daily email limit reached/);
    const [afterRetry] = await db.select().from(outgoingEmails).where(eq(outgoingEmails.id, heldBack.email.id));
    assert.deepEqual([afterRetry.status, afterRetry.attemptCount, afterRetry.providerMessageId], ["pending", 0, null]);

    // Closing without emailing sends nothing, so the cap doesn't stand in its way.
    const quiet = await createTicketForCompany(capped.companyId, { subject: "Spam", description: "x", channel: "email", customerEmail: `cap-spam-${runId}@example.test` });
    assert.deepEqual(await closeTicketWithoutEmailForSession(sessionFor(capped), { ticketId: quiet.id }), { ok: true });

    const otherOwner = await signUpTestOwner("email-cap-other");
    const elsewhere = await solveEmailTicket(otherOwner, `cap-other-${runId}@example.test`);
    assert.deepEqual(elsewhere.result, { ok: true });
    assert.equal(elsewhere.email.status, "sent");
    assert.equal((await getLatestCustomerEmailForSession(sessionFor(otherOwner), elsewhere.ticketId))?.heldBackByDailyLimit, false);

    // The next day the window starts over. Here the three attempts since the
    // 299th (email #300, email #301 and its Retry) are given back instead.
    for (let attempt = 0; attempt < 3; attempt++) {
      await takeBackRateLimitAttempt("customer-emails", capped.companyId);
    }
    assert.deepEqual(await retryCustomerEmailForSession(sessionFor(capped), { emailId: heldBack.email.id }), { ok: true });
    const sentLater = await onPage();
    assert.deepEqual([sentLater?.status, sentLater?.heldBackByDailyLimit], ["sent", false], "the 'daily limit' line must go once it is sent");
  });
}
