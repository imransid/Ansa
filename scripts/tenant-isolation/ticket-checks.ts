// Ticket checks: each company sees only its own tickets, ticket numbers are
// per company and never repeat, and callers cannot choose server-owned fields.

import assert from "node:assert/strict";
import { createTicketForCompany, listTicketsForSession } from "@/services/tickets";
import { check, sessionFor, type TestUser } from "./helpers";

function sampleTicket(subject: string) {
  return { subject, description: "Created by the tenant isolation checks.", channel: "phone" };
}

export async function runTicketChecks(ownerA: TestUser, ownerB: TestUser) {
  const firstA = await createTicketForCompany(ownerA.companyId, sampleTicket("A first"));
  const secondA = await createTicketForCompany(ownerA.companyId, sampleTicket("A second"));
  const firstB = await createTicketForCompany(ownerB.companyId, sampleTicket("B first"));

  await check("ticket numbers start at 1 and count up separately per company", async () => {
    assert.equal(firstA.ticketNumber, 1);
    assert.equal(secondA.ticketNumber, 2);
    assert.equal(firstB.ticketNumber, 1);
  });

  await check("company A's ticket list contains only company A's tickets, newest first", async () => {
    const ticketsForA = await listTicketsForSession(sessionFor(ownerA));
    assert.deepEqual(ticketsForA.map((ticket) => ticket.id), [secondA.id, firstA.id]);
  });

  await check("company B's ticket list contains only company B's tickets", async () => {
    const ticketsForB = await listTicketsForSession(sessionFor(ownerB));
    assert.deepEqual(ticketsForB.map((ticket) => ticket.id), [firstB.id]);
  });

  await check("tickets created at the same moment never share a number", async () => {
    const parallelTickets = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createTicketForCompany(ownerB.companyId, sampleTicket(`B parallel ${index}`)),
      ),
    );
    const numbers = parallelTickets.map((ticket) => ticket.ticketNumber).sort((a, b) => a - b);
    assert.deepEqual(numbers, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  await check("a new ticket ignores companyId, ticketNumber and status sent by the caller", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, {
      ...sampleTicket("A smuggled fields"),
      companyId: ownerB.companyId,
      ticketNumber: 999,
      status: "solved",
    });
    assert.equal(ticket.companyId, ownerA.companyId);
    assert.equal(ticket.ticketNumber, 3);
    assert.equal(ticket.status, "open");
  });

  await check("invalid ticket input is rejected", async () => {
    await assert.rejects(createTicketForCompany(ownerA.companyId, { ...sampleTicket(""), subject: "" }));
    await assert.rejects(createTicketForCompany(ownerA.companyId, { ...sampleTicket("Fax"), channel: "fax" }));
  });
}
