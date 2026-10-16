// Assignment and solving checks: a ticket can only ever point at people in its
// own company (checked by the service AND by the database), other companies
// cannot touch it, and only owners can reopen.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tickets } from "@/db/schema";
import {
  assignTicketForSession,
  createTicketForCompany,
  getTicketForSession,
  markTicketSolvedForSession,
  reopenTicketForSession,
} from "@/services/tickets";
import { addTeammate, assertRefusedByConstraint, check, sessionFor, type TestUser } from "./helpers";

function newTicket(subject: string) {
  return { subject, description: "Created by the assignment checks.", channel: "email" };
}

async function readTicket(user: TestUser, ticketNumber: number) {
  const ticket = await getTicketForSession(sessionFor(user), ticketNumber);
  assert.ok(ticket, `ticket #${ticketNumber} not found for ${user.email}`);
  return ticket;
}

export async function runAssignmentChecks(ownerA: TestUser, ownerB: TestUser) {
  const memberA = await addTeammate(ownerA, "assignee-member", "member");
  const ticketA = await createTicketForCompany(ownerA.companyId, newTicket("A needs an expert"));

  await check("a ticket can be assigned to a teammate in the same company", async () => {
    const result = await assignTicketForSession(sessionFor(ownerA), { ticketId: ticketA.id, assigneeUserId: memberA.id });
    assert.equal(result.ok, true);
    const ticket = await readTicket(ownerA, ticketA.ticketNumber);
    assert.equal(ticket.assignedToUserId, memberA.id);
    assert.equal(ticket.assigneeName, "Invited");
  });

  await check("assigning to a user from another company is refused and changes nothing", async () => {
    const result = await assignTicketForSession(sessionFor(ownerA), { ticketId: ticketA.id, assigneeUserId: ownerB.id });
    assert.equal(result.ok, false);
    const ticket = await readTicket(ownerA, ticketA.ticketNumber);
    assert.equal(ticket.assignedToUserId, memberA.id);
  });

  await check("assigning to a made-up user id is refused", async () => {
    const result = await assignTicketForSession(sessionFor(ownerA), { ticketId: ticketA.id, assigneeUserId: "not-a-real-user" });
    assert.equal(result.ok, false);
  });

  await check("the database itself refuses a cross-company assignee or solver", async () => {
    await assertRefusedByConstraint(
      db.update(tickets).set({ assignedToUserId: ownerB.id }).where(eq(tickets.id, ticketA.id)),
      "tickets_assignee_in_same_company_fk",
    );
    await assertRefusedByConstraint(
      db
        .update(tickets)
        .set({ status: "solved", solvedAt: new Date(), solvedByUserId: ownerB.id })
        .where(eq(tickets.id, ticketA.id)),
      "tickets_solver_in_same_company_fk",
    );
  });

  await check("the database refuses a solved ticket without solved time and solver", async () => {
    await assertRefusedByConstraint(
      db.update(tickets).set({ status: "solved" }).where(eq(tickets.id, ticketA.id)),
      "tickets_solved_fields_match_status",
    );
  });

  await check("another company cannot assign, solve or reopen the ticket", async () => {
    const sessionB = sessionFor(ownerB);
    assert.equal((await assignTicketForSession(sessionB, { ticketId: ticketA.id, assigneeUserId: ownerB.id })).ok, false);
    assert.equal((await assignTicketForSession(sessionB, { ticketId: ticketA.id, assigneeUserId: "" })).ok, false);
    assert.equal((await markTicketSolvedForSession(sessionB, { ticketId: ticketA.id })).ok, false);
    assert.equal((await reopenTicketForSession(sessionB, { ticketId: ticketA.id })).ok, false);
    const ticket = await readTicket(ownerA, ticketA.ticketNumber);
    assert.equal(ticket.status, "open");
    assert.equal(ticket.assignedToUserId, memberA.id);
  });

  await check("a member can mark the ticket solved, and it records who and when", async () => {
    const result = await markTicketSolvedForSession(sessionFor(memberA), { ticketId: ticketA.id });
    assert.equal(result.ok, true);
    const ticket = await readTicket(ownerA, ticketA.ticketNumber);
    assert.equal(ticket.status, "solved");
    assert.equal(ticket.solvedByUserId, memberA.id);
    assert.ok(ticket.solvedAt);
  });

  await check("solving an already solved ticket is refused", async () => {
    const result = await markTicketSolvedForSession(sessionFor(ownerA), { ticketId: ticketA.id });
    assert.equal(result.ok, false);
  });

  await check("a member cannot reopen a ticket", async () => {
    const result = await reopenTicketForSession(sessionFor(memberA), { ticketId: ticketA.id });
    assert.equal(result.ok, false);
    assert.equal((await readTicket(ownerA, ticketA.ticketNumber)).status, "solved");
  });

  await check("an owner can reopen, which clears solved time and solver", async () => {
    const result = await reopenTicketForSession(sessionFor(ownerA), { ticketId: ticketA.id });
    assert.equal(result.ok, true);
    const ticket = await readTicket(ownerA, ticketA.ticketNumber);
    assert.equal(ticket.status, "open");
    assert.equal(ticket.solvedAt, null);
    assert.equal(ticket.solvedByUserId, null);
    const solvedAgain = await markTicketSolvedForSession(sessionFor(ownerA), { ticketId: ticketA.id });
    assert.equal(solvedAgain.ok, true);
  });

  await check("unassigning sets the ticket back to unassigned", async () => {
    const result = await assignTicketForSession(sessionFor(ownerA), { ticketId: ticketA.id, assigneeUserId: "" });
    assert.equal(result.ok, true);
    assert.equal((await readTicket(ownerA, ticketA.ticketNumber)).assignedToUserId, null);
  });

  await check("ticket numbers never reach into another company", async () => {
    // Both companies have a ticket #1: each session must get its own.
    const firstForA = await readTicket(ownerA, 1);
    const firstForB = await readTicket(ownerB, 1);
    assert.equal(firstForA.companyId, ownerA.companyId);
    assert.equal(firstForB.companyId, ownerB.companyId);
    // A's newest number does not exist in B (B has fewer tickets).
    assert.equal(await getTicketForSession(sessionFor(ownerB), ticketA.ticketNumber + 1000), null);
  });

  await check("bad ticket numbers in the URL are rejected", async () => {
    for (const badNumber of ["abc", "0", "-1", "1.5", ""]) {
      assert.equal(await getTicketForSession(sessionFor(ownerA), badNumber), null, `"${badNumber}" was accepted`);
    }
  });
}
