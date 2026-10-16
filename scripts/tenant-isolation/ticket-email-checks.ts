// Customer-email-on-ticket checks (step 9): only the ticket's own company can
// set or change it, it must be confirmed and valid, who and when are recorded,
// future solves use the new address, and queued emails never change recipient.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { outgoingEmails, tickets } from "@/db/schema";
import { retryCustomerEmailForSession } from "@/services/customer-emails";
import {
  createTicketForCompany,
  getTicketForSession,
  markTicketSolvedForSession,
  setCustomerEmailForSession,
} from "@/services/tickets";
import { addTeammate, assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

function phoneTicket(subject: string) {
  return { subject, description: "From a phone call, no email on file.", channel: "phone" };
}

async function stored(ticketId: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  return ticket;
}

export async function runTicketEmailChecks(ownerA: TestUser, ownerB: TestUser) {
  const memberA = await addTeammate(ownerA, "email-setter", "member");
  const customer = `customer-step9-${runId}@example.test`;

  await check("ticket email: a member can set it, it is cleaned up, and who/when is recorded", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, phoneTicket("Needs an email"));
    const { result, logs } = await captureConsole(() =>
      setCustomerEmailForSession(sessionFor(memberA), { ticketId: ticket.id, customerEmail: `  ${customer.toUpperCase()} `, confirmed: "yes" }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(logs, []);
    const saved = await stored(ticket.id);
    assert.equal(saved.customerEmail, customer);
    assert.equal(saved.customerEmailSetByUserId, memberA.id);
    assert.ok(saved.customerEmailSetAt);
    const detail = await getTicketForSession(sessionFor(ownerA), ticket.ticketNumber);
    assert.equal(detail?.customerEmailSetByName, "Invited");
  });

  await check("ticket email: unconfirmed, invalid or other-company changes are refused", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, phoneTicket("Stays empty"));
    const attempts = [
      setCustomerEmailForSession(sessionFor(ownerA), { ticketId: ticket.id, customerEmail: customer }),
      setCustomerEmailForSession(sessionFor(ownerA), { ticketId: ticket.id, customerEmail: customer, confirmed: "no" }),
      setCustomerEmailForSession(sessionFor(ownerA), { ticketId: ticket.id, customerEmail: "not an email", confirmed: "yes" }),
      setCustomerEmailForSession(sessionFor(ownerB), { ticketId: ticket.id, customerEmail: customer, confirmed: "yes" }),
    ];
    for (const attempt of await Promise.all(attempts)) {
      assert.equal(attempt.ok, false);
    }
    const unchanged = await stored(ticket.id);
    assert.equal(unchanged.customerEmail, null);
    assert.equal(unchanged.customerEmailSetByUserId, null);
  });

  await check("ticket email: the database refuses a setter from another company or half the fields", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, phoneTicket("DB guard"));
    await assertRefusedByConstraint(
      db.update(tickets).set({ customerEmailSetByUserId: ownerB.id, customerEmailSetAt: new Date() }).where(eq(tickets.id, ticket.id)),
      "tickets_email_setter_in_same_company_fk",
    );
    await assertRefusedByConstraint(
      db.update(tickets).set({ customerEmailSetByUserId: ownerA.id }).where(eq(tickets.id, ticket.id)),
      "tickets_email_setter_fields_together",
    );
  });

  await check("ticket email: solving afterwards emails the new address; a solved ticket gets nothing sent", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, phoneTicket("Email then solve"));
    await setCustomerEmailForSession(sessionFor(memberA), { ticketId: ticket.id, customerEmail: customer, confirmed: "yes" });
    await markTicketSolvedForSession(sessionFor(memberA), { ticketId: ticket.id });
    const emails = await db.select().from(outgoingEmails).where(eq(outgoingEmails.ticketId, ticket.id));
    assert.equal(emails.length, 1);
    assert.equal(emails[0].toEmail, customer);

    const solvedFirst = await createTicketForCompany(ownerA.companyId, phoneTicket("Solve then email"));
    await markTicketSolvedForSession(sessionFor(memberA), { ticketId: solvedFirst.id });
    await setCustomerEmailForSession(sessionFor(memberA), { ticketId: solvedFirst.id, customerEmail: customer, confirmed: "yes" });
    const none = await db.select().from(outgoingEmails).where(eq(outgoingEmails.ticketId, solvedFirst.id));
    assert.equal(none.length, 0, "adding an email to a solved ticket sent something");
  });

  await check("ticket email: changing the address never redirects an email already queued", async () => {
    const first = `first-${runId}@example.test`;
    const second = `second-${runId}@example.test`;
    const ticket = await createTicketForCompany(ownerA.companyId, phoneTicket("Change after failure"));
    await setCustomerEmailForSession(sessionFor(ownerA), { ticketId: ticket.id, customerEmail: first, confirmed: "yes" });
    await markTicketSolvedForSession(sessionFor(ownerA), { ticketId: ticket.id });
    const [email] = await db.select().from(outgoingEmails).where(eq(outgoingEmails.ticketId, ticket.id));
    await db.update(outgoingEmails).set({ status: "failed" }).where(eq(outgoingEmails.id, email.id));

    await setCustomerEmailForSession(sessionFor(ownerA), { ticketId: ticket.id, customerEmail: second, confirmed: "yes" });
    assert.equal((await retryCustomerEmailForSession(sessionFor(ownerA), { emailId: email.id })).ok, true);
    const [retried] = await db.select().from(outgoingEmails).where(eq(outgoingEmails.id, email.id));
    assert.equal(retried.toEmail, first);
    assert.equal(retried.status, "sent");
    assert.equal((await stored(ticket.id)).customerEmail, second);
  });
}
