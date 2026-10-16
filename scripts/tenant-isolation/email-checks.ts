// Email checks: solving a ticket queues exactly one email to the right customer,
// emails stay inside their company, nothing is really sent while
// SEND_REAL_EMAIL is off, and email content cannot be used to inject HTML or headers.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, outgoingEmails } from "@/db/schema";
import { renderTicketSolvedEmail } from "@/lib/emails/ticket-solved";
import { parseEnv } from "@/lib/env";
import { buildFromHeader, isRealEmailOn } from "@/lib/send-email";
import { getLatestCustomerEmailForSession, retryCustomerEmailForSession } from "@/services/customer-emails";
import { createTicketForCompany, markTicketSolvedForSession, reopenTicketForSession } from "@/services/tickets";
import { assertRefusedByConstraint, check, devOutboxPath, runId, sessionFor, type TestUser } from "./helpers";

const customerEmail = `customer-${runId}@example.test`;

function emailsForTicket(ticketId: string) {
  return db.select().from(outgoingEmails).where(eq(outgoingEmails.ticketId, ticketId));
}

async function latestEmail(user: TestUser, ticketId: string) {
  const email = await getLatestCustomerEmailForSession(sessionFor(user), ticketId);
  assert.ok(email, "no email found");
  return email;
}

function markFailed(emailId: string) {
  return db.update(outgoingEmails).set({ status: "failed" }).where(eq(outgoingEmails.id, emailId));
}

export async function runEmailChecks(ownerA: TestUser, ownerB: TestUser) {
  const sessionA = sessionFor(ownerA);
  const replyTo = `help-${runId}@example.test`;
  await db.update(companies).set({ replyToEmail: replyTo }).where(eq(companies.id, ownerA.companyId));
  const ticket = await createTicketForCompany(ownerA.companyId, {
    subject: "Email check",
    description: "Secret call notes that must not be emailed.",
    channel: "email",
    customerName: "Casey",
    customerEmail,
  });

  await check("solving queues and delivers exactly one email to the ticket's customer", async () => {
    assert.equal((await markTicketSolvedForSession(sessionA, { ticketId: ticket.id })).ok, true);
    const rows = await emailsForTicket(ticket.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].companyId, ownerA.companyId);
    assert.equal(rows[0].toEmail, customerEmail);
    assert.equal(rows[0].status, "sent");
  });

  await check("with SEND_REAL_EMAIL off, the email is only written to .dev-emails", async () => {
    assert.equal(isRealEmailOn(), false);
    const email = await latestEmail(ownerA, ticket.id);
    const providerMessageId = email.providerMessageId ?? "";
    assert.ok(providerMessageId.startsWith("dev-outbox:"), `sent via ${providerMessageId}`);
    const file = await readFile(devOutboxPath(providerMessageId), "utf8");
    assert.ok(file.includes(customerEmail));
    assert.ok(file.includes(replyTo), "company reply_to_email is not the Reply-To");
    assert.ok(!file.includes("Secret call notes"), "the ticket description leaked into the email");
  });

  await check("a refused solve queues no email", async () => {
    assert.equal((await markTicketSolvedForSession(sessionA, { ticketId: ticket.id })).ok, false);
    const other = await createTicketForCompany(ownerA.companyId, { subject: "B tries", description: "x", channel: "email", customerEmail });
    assert.equal((await markTicketSolvedForSession(sessionFor(ownerB), { ticketId: other.id })).ok, false);
    assert.equal((await emailsForTicket(ticket.id)).length, 1);
    assert.equal((await emailsForTicket(other.id)).length, 0);
  });

  await check("a ticket without a customer email queues no email", async () => {
    const phoneOnly = await createTicketForCompany(ownerA.companyId, { subject: "Phone only", description: "x", channel: "phone" });
    assert.equal((await markTicketSolvedForSession(sessionA, { ticketId: phoneOnly.id })).ok, true);
    assert.equal((await emailsForTicket(phoneOnly.id)).length, 0);
  });

  const firstEmail = await latestEmail(ownerA, ticket.id);

  await check("reopening and solving again queues and sends a second email", async () => {
    assert.equal((await reopenTicketForSession(sessionA, { ticketId: ticket.id })).ok, true);
    assert.equal((await markTicketSolvedForSession(sessionA, { ticketId: ticket.id })).ok, true);
    assert.equal((await emailsForTicket(ticket.id)).length, 2);
    const secondEmail = await latestEmail(ownerA, ticket.id);
    assert.notEqual(secondEmail.id, firstEmail.id);
    assert.equal(secondEmail.status, "sent");
  });

  await check("an email from an earlier solve cannot be re-sent", async () => {
    await markFailed(firstEmail.id);
    assert.equal((await retryCustomerEmailForSession(sessionA, { emailId: firstEmail.id })).ok, false);
  });

  await check("a failed email can be retried and is then sent", async () => {
    const current = await latestEmail(ownerA, ticket.id);
    await markFailed(current.id);
    assert.equal((await retryCustomerEmailForSession(sessionA, { emailId: current.id })).ok, true);
    const [row] = await db.select().from(outgoingEmails).where(eq(outgoingEmails.id, current.id));
    assert.equal(row.status, "sent");
    assert.equal(row.attemptCount, 2);
  });

  await check("a sent email cannot be retried", async () => {
    const current = await latestEmail(ownerA, ticket.id);
    assert.equal((await retryCustomerEmailForSession(sessionA, { emailId: current.id })).ok, false);
  });

  await check("another company can neither see nor retry the email", async () => {
    const current = await latestEmail(ownerA, ticket.id);
    await markFailed(current.id);
    assert.equal(await getLatestCustomerEmailForSession(sessionFor(ownerB), ticket.id), null);
    assert.equal((await retryCustomerEmailForSession(sessionFor(ownerB), { emailId: current.id })).ok, false);
    const [row] = await db.select().from(outgoingEmails).where(eq(outgoingEmails.id, current.id));
    assert.equal(row.status, "failed");
  });

  await check("the database refuses an email row for another company's ticket", async () => {
    await assertRefusedByConstraint(
      db.insert(outgoingEmails).values({ companyId: ownerB.companyId, ticketId: ticket.id, kind: "ticket_solved", toEmail: customerEmail }),
      "outgoing_emails_ticket_in_same_company_fk",
    );
  });

  await check("names are HTML-escaped and cannot break the From header", async () => {
    const email = renderTicketSolvedEmail({ companyName: "Acme", customerName: "<script>x</script>", ticketNumber: 1, ticketSubject: "<b>hi</b>" });
    assert.ok(!email.html.includes("<script>") && email.html.includes("&lt;script&gt;"));
    assert.ok(!email.html.includes("<b>hi</b>"));
    const from = buildFromHeader('Evil"\r\nBcc: victim@example.com <x>');
    assert.ok(!/[\r\n]/.test(from), "line break survived");
    assert.equal(from.split("<").length, 2, "an extra < survived");
  });

  await check("only SEND_REAL_EMAIL=true turns real email on, and it needs a key and a From address", async () => {
    const base = { DATABASE_URL: "postgres://x@localhost/x", BETTER_AUTH_SECRET: "s".repeat(32), BETTER_AUTH_URL: "http://localhost:3000" };
    assert.equal(parseEnv(base).SEND_REAL_EMAIL, undefined);
    assert.throws(() => parseEnv({ ...base, SEND_REAL_EMAIL: "true" }), /RESEND_API_KEY is required/);
    assert.throws(() => parseEnv({ ...base, SEND_REAL_EMAIL: "true", RESEND_API_KEY: "re_x" }), /EMAIL_FROM is required/);
    assert.throws(() => parseEnv({ ...base, SEND_REAL_EMAIL: "yes" }));
    assert.throws(() => parseEnv({ ...base, SEND_REAL_EMAIL: "TRUE" }));
    const on = parseEnv({ ...base, SEND_REAL_EMAIL: "true", RESEND_API_KEY: "re_x", EMAIL_FROM: "support@example.com" });
    assert.equal(on.SEND_REAL_EMAIL, "true");
  });
}
