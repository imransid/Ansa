// Closing checks (step 25): "Close without emailing" solves a ticket without
// queuing any email, only inside its own company, and reopening clears it; the
// database refuses the flag on an open ticket; no email is ever delivered for
// a ticket closed that way; "Mark as solved" only goes through while the ticket
// still has exactly the address the person confirmed; and a reopened ticket's
// page keeps warning that its last email to that address bounced, until the
// address is changed.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { outgoingEmails, tickets } from "@/db/schema";
import { lastDeliveryProblemFor } from "@/lib/last-delivery-problem";
import { getLatestCustomerEmailForSession, retryCustomerEmailForSession } from "@/services/customer-emails";
import { closeTicketWithoutEmailForSession, markTicketSolvedForSession, reopenTicketForSession } from "@/services/ticket-status";
import { createTicketForCompany, getTicketForSession, setCustomerEmailForSession } from "@/services/tickets";
import { addTeammate, assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

function emailTicket(subject: string, customerEmail: string) {
  return { subject, description: "From the closing checks.", channel: "email", customerEmail };
}

async function stored(ticketId: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  return ticket;
}

function emailsOf(ticketId: string) {
  return db.select().from(outgoingEmails).where(eq(outgoingEmails.ticketId, ticketId));
}

// otherCompany is any owner of another company.
export async function runClosingChecks(otherCompany: TestUser) {
  // A company of its own, so these solves don't use up the shared owners' limits.
  const owner = await signUpTestOwner("closing");
  const member = await addTeammate(owner, "closer", "member");
  const customer = `closing-${runId}@example.test`;

  await check("close without emailing: a member closes the ticket, it is recorded, and no email row is written", async () => {
    const ticket = await createTicketForCompany(owner.companyId, emailTicket("Thanks!", customer));
    assert.deepEqual(await closeTicketWithoutEmailForSession(sessionFor(member), { ticketId: ticket.id }), { ok: true });
    const closed = await stored(ticket.id);
    assert.deepEqual([closed.status, closed.solvedWithoutEmail, closed.solvedByUserId], ["solved", true, member.id]);
    assert.ok(closed.solvedAt);
    assert.equal((await emailsOf(ticket.id)).length, 0);
    assert.equal((await closeTicketWithoutEmailForSession(sessionFor(member), { ticketId: ticket.id })).ok, false, "closed twice");
    assert.equal((await markTicketSolvedForSession(sessionFor(member), { ticketId: ticket.id, confirmedCustomerEmail: customer })).ok, false);
    assert.equal((await emailsOf(ticket.id)).length, 0);
  });

  await check("close without emailing: another company can't close the ticket", async () => {
    const ticket = await createTicketForCompany(owner.companyId, emailTicket("Spam", customer));
    assert.equal((await closeTicketWithoutEmailForSession(sessionFor(otherCompany), { ticketId: ticket.id })).ok, false);
    assert.equal((await closeTicketWithoutEmailForSession(sessionFor(owner), { ticketId: "not-a-uuid" })).ok, false);
    const untouched = await stored(ticket.id);
    assert.deepEqual([untouched.status, untouched.solvedWithoutEmail, untouched.solvedByUserId], ["open", false, null]);
    assert.equal((await emailsOf(ticket.id)).length, 0);
  });

  await check("close without emailing: reopening clears it, and marking it solved then emails the customer", async () => {
    const ticket = await createTicketForCompany(owner.companyId, emailTicket("Duplicate", customer));
    await closeTicketWithoutEmailForSession(sessionFor(member), { ticketId: ticket.id });
    assert.deepEqual(await reopenTicketForSession(sessionFor(owner), { ticketId: ticket.id }), { ok: true });
    const reopened = await stored(ticket.id);
    assert.deepEqual([reopened.status, reopened.solvedWithoutEmail, reopened.solvedAt], ["open", false, null]);
    assert.deepEqual(await markTicketSolvedForSession(sessionFor(member), { ticketId: ticket.id, confirmedCustomerEmail: customer }), { ok: true });
    const emails = await emailsOf(ticket.id);
    assert.deepEqual(emails.map((email) => [email.toEmail, email.status]), [[customer, "sent"]]);
    assert.equal((await stored(ticket.id)).solvedWithoutEmail, false);
  });

  await check("close without emailing: no email goes out for that ticket, not even a retry of an earlier one", async () => {
    const ticket = await createTicketForCompany(owner.companyId, emailTicket("Solved, reopened, closed", customer));
    await markTicketSolvedForSession(sessionFor(owner), { ticketId: ticket.id, confirmedCustomerEmail: customer });
    const [earlier] = await emailsOf(ticket.id);
    await db.update(outgoingEmails).set({ status: "failed" }).where(eq(outgoingEmails.id, earlier.id));
    await reopenTicketForSession(sessionFor(owner), { ticketId: ticket.id });
    await closeTicketWithoutEmailForSession(sessionFor(owner), { ticketId: ticket.id });
    assert.equal((await retryCustomerEmailForSession(sessionFor(owner), { emailId: earlier.id })).ok, false);
    // Even a row written after the close (a bug elsewhere) is never delivered.
    const [stray] = await db.insert(outgoingEmails).values({ companyId: owner.companyId, ticketId: ticket.id, kind: "ticket_solved", toEmail: customer }).returning();
    assert.equal((await retryCustomerEmailForSession(sessionFor(owner), { emailId: stray.id })).ok, false);
    const statuses = (await emailsOf(ticket.id)).map((email) => email.status).sort();
    assert.deepEqual(statuses, ["failed", "pending"]);
  });

  await check("close without emailing: the database refuses the flag on an open ticket", async () => {
    const ticket = await createTicketForCompany(owner.companyId, emailTicket("DB guard", customer));
    await assertRefusedByConstraint(
      db.update(tickets).set({ solvedWithoutEmail: true }).where(eq(tickets.id, ticket.id)),
      "tickets_solved_without_email_only_when_solved",
    );
  });

  await check("mark as solved: only with the address the person saw, never one changed or added since", async () => {
    const changed = await createTicketForCompany(owner.companyId, emailTicket("Changed meanwhile", customer));
    const newAddress = `closing-new-${runId}@example.test`;
    await setCustomerEmailForSession(sessionFor(owner), { ticketId: changed.id, customerEmail: newAddress, confirmed: "yes" });
    // The member's page still showed the old address, or the form left the field out.
    assert.equal((await markTicketSolvedForSession(sessionFor(member), { ticketId: changed.id, confirmedCustomerEmail: customer })).ok, false);
    assert.equal((await markTicketSolvedForSession(sessionFor(member), { ticketId: changed.id, confirmedCustomerEmail: "" })).ok, false);
    assert.equal((await markTicketSolvedForSession(sessionFor(member), { ticketId: changed.id })).ok, false);
    assert.equal((await stored(changed.id)).status, "open");
    assert.equal((await emailsOf(changed.id)).length, 0);
    assert.deepEqual(await markTicketSolvedForSession(sessionFor(member), { ticketId: changed.id, confirmedCustomerEmail: newAddress }), { ok: true });
    assert.deepEqual((await emailsOf(changed.id)).map((email) => email.toEmail), [newAddress]);

    // A page that showed no address can't solve once one was added: that solve would email without asking.
    const added = await createTicketForCompany(owner.companyId, { subject: "Email added meanwhile", description: "x", channel: "phone" });
    await setCustomerEmailForSession(sessionFor(owner), { ticketId: added.id, customerEmail: customer, confirmed: "yes" });
    assert.equal((await markTicketSolvedForSession(sessionFor(member), { ticketId: added.id, confirmedCustomerEmail: "" })).ok, false);
    assert.equal((await emailsOf(added.id)).length, 0);
  });

  await check("reopened: the page keeps warning that the last email to this address bounced, until the address changes; other companies see nothing", async () => {
    const ticket = await createTicketForCompany(owner.companyId, emailTicket("Bounced", customer));
    await markTicketSolvedForSession(sessionFor(owner), { ticketId: ticket.id, confirmedCustomerEmail: customer });
    await db.update(outgoingEmails).set({ deliveryProblem: "bounced", deliveryProblemAt: new Date() }).where(eq(outgoingEmails.ticketId, ticket.id));
    await reopenTicketForSession(sessionFor(owner), { ticketId: ticket.id });
    // The warning the open ticket's page shows, from the same reads and the
    // same decision (OpenTicketEmailStatus) the page uses.
    const warningOnPage = async () => {
      const onPage = await getTicketForSession(sessionFor(member), String(ticket.ticketNumber));
      const latest = await getLatestCustomerEmailForSession(sessionFor(member), ticket.id);
      return lastDeliveryProblemFor(onPage?.customerEmail ?? null, latest);
    };
    assert.equal(await warningOnPage(), "bounced");
    await setCustomerEmailForSession(sessionFor(member), { ticketId: ticket.id, customerEmail: `closing-fixed-${runId}@example.test`, confirmed: "yes" });
    assert.equal(await warningOnPage(), null, "a corrected address has nothing to warn about");
    assert.equal(lastDeliveryProblemFor(customer, { toEmail: customer, deliveryProblem: "complained" }), "complained");
    assert.equal(lastDeliveryProblemFor(customer, { toEmail: customer, deliveryProblem: null }), null);
    assert.equal(lastDeliveryProblemFor(null, { toEmail: customer, deliveryProblem: "bounced" }), null);
    assert.equal(await getLatestCustomerEmailForSession(sessionFor(otherCompany), ticket.id), null);
  });
}
