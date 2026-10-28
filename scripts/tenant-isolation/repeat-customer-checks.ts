// Repeat customer checks (step 29): a new ticket from a customer (same phone
// number by its digits, or same email) who already has an open ticket with
// someone goes to that person, recorded as automatic routing, whatever its
// category; never to someone in another company, removed or unconfirmed;
// never for numbers that can't tell customers apart (too short, or a
// carrier's placeholder for a hidden number), or for solved tickets.
// The ticket page lists the customer's other open tickets, same company only.
// FAKE model only.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { tickets } from "@/db/schema";
import { analyzeCall } from "@/services/call-analysis";
import { setUserCategoriesForSession } from "@/services/categories";
import { markTicketSolvedForSession } from "@/services/ticket-status";
import { assignTicketForSession, createTicketForCompany, listOtherOpenTicketsFromCustomerForSession } from "@/services/tickets";
import { answer } from "./brain-guard-checks";
import { fakeModel, saveTestCall } from "./brain-test-calls";
import { addTeammate, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { addCategory, joinWithoutConfirming, markRemovedInDatabaseOnly, storedTicket } from "./team-helpers";

type Contact = { customerPhone?: string; customerEmail?: string };

// category null = no category.
function ticketFrom(owner: TestUser, contact: Contact, category: string | null = "Repeat billing") {
  return createTicketForCompany(owner.companyId, { subject: "Repeat check", description: "x", channel: "phone", category, ...contact });
}

// The "a ticket is yours" emails the dev outbox wrote for one ticket.
async function assignmentEmails(ticketId: string): Promise<string[]> {
  const outbox = path.join(process.cwd(), ".dev-emails");
  const files = (await readdir(outbox).catch(() => [] as string[])).filter((file) => file.includes(`ticket-assigned-${ticketId}-`));
  return Promise.all(files.map((file) => readFile(path.join(outbox, file), "utf8")));
}

export async function runRepeatCustomerChecks() {
  const owner = await signUpTestOwner("repeat");
  const asOwner = sessionFor(owner);
  // expert1 handles "Repeat billing"; expert2 handles nothing.
  const expert1 = await addTeammate(owner, "repeat-1", "member");
  const expert2 = await addTeammate(owner, "repeat-2", "member");
  const billingId = await addCategory(owner, "Repeat billing");
  await setUserCategoriesForSession(sessionFor(expert1), { userId: expert1.id, categoryIds: [billingId] });
  const giveTo = (ticketId: string, person: TestUser) => assignTicketForSession(asOwner, { ticketId, assigneeUserId: person.id });

  await check("repeat customer: a new ticket goes to whoever has the customer's open ticket, whatever its category, recorded as routed", async () => {
    const first = await ticketFrom(owner, { customerPhone: "+1 (555) 012-3456" });
    assert.equal(first.assignedToUserId, expert1.id, "the first ticket is routed by its category");
    await giveTo(first.id, expert2);
    const second = await ticketFrom(owner, { customerPhone: "+15550123456" });
    assert.deepEqual([second.assignedToUserId, second.assignedAutomatically, second.routedToUserId], [expert2.id, true, expert2.id]);
    const stored = await storedTicket(second.id);
    assert.deepEqual([stored.assignedToUserId, stored.assignedAutomatically, stored.routedToUserId], [expert2.id, true, expert2.id]);
    // expert2 doesn't handle the category: the email must not say they do.
    const emails = await assignmentEmails(second.id);
    assert.equal(emails.length, 1);
    assert.ok(emails[0].includes("It was routed to you automatically.") && !emails[0].includes("because you handle"), "the email claims a category");
    // expert1 does: routing by category still says so.
    const firstEmails = await assignmentEmails(first.id);
    assert.ok(firstEmails.some((email) => email.includes("because you handle Repeat billing")));
  });

  await check("repeat customer: the same email in any letter case counts; the newest open ticket's person gets it", async () => {
    const address = `kim.repeat-${runId}@customer.test`;
    const older = await ticketFrom(owner, { customerEmail: address });
    await giveTo(older.id, expert1);
    const newer = await ticketFrom(owner, { customerEmail: address.toUpperCase() });
    await giveTo(newer.id, expert2);
    const newest = await ticketFrom(owner, { customerEmail: address }, null);
    assert.equal(newest.assignedToUserId, expert2.id);
  });

  await check("repeat customer: never another company's person, nor anyone removed or unconfirmed", async () => {
    const other = await signUpTestOwner("repeat-other");
    const theirs = await ticketFrom(other, { customerPhone: "+1 555 0999 001" }, null);
    await assignTicketForSession(sessionFor(other), { ticketId: theirs.id, assigneeUserId: other.id });
    assert.equal((await ticketFrom(owner, { customerPhone: "+1 555 0999 001" })).assignedToUserId, expert1.id);

    // The customer's older ticket is expert2's; the newer one sits on someone
    // who can't take tickets. The next ticket skips them and goes to expert2.
    const leaver = await addTeammate(owner, "repeat-leaver", "member");
    await giveTo((await ticketFrom(owner, { customerPhone: "+1 555 0999 002" }, null)).id, expert2);
    const leftBehind = await ticketFrom(owner, { customerPhone: "+1 555 0999 002" }, null);
    await giveTo(leftBehind.id, leaver);
    // As if a removal slipped in and left the ticket on them.
    await markRemovedInDatabaseOnly(leaver.id);
    assert.equal((await ticketFrom(owner, { customerPhone: "+1 555 0999 002" })).assignedToUserId, expert2.id);

    const unconfirmed = await joinWithoutConfirming(owner, "repeat-unconfirmed");
    await giveTo((await ticketFrom(owner, { customerPhone: "+1 555 0999 003" }, null)).id, expert2);
    const heldByUnconfirmed = await ticketFrom(owner, { customerPhone: "+1 555 0999 003" }, null);
    await db.update(tickets).set({ assignedToUserId: unconfirmed.id, assignedAutomatically: false }).where(eq(tickets.id, heldByUnconfirmed.id));
    assert.equal((await ticketFrom(owner, { customerPhone: "+1 555 0999 003" })).assignedToUserId, expert2.id);
  });

  await check("repeat customer: hidden, too-short and placeholder caller numbers, and solved tickets, don't count", async () => {
    // "+266696687" and "+8656696" are Twilio's ANONYMOUS and UNKNOWN: every
    // caller who hides their number arrives with the same one.
    for (const phone of ["anonymous", "12345", "+266696687", "+8656696", "0000000000"]) {
      const earlier = await ticketFrom(owner, { customerPhone: phone }, null);
      await giveTo(earlier.id, expert2);
      const next = await ticketFrom(owner, { customerPhone: phone });
      assert.equal(next.assignedToUserId, expert1.id, `"${phone}" matched`);
      assert.deepEqual(await listOtherOpenTicketsFromCustomerForSession(asOwner, next.id), [], `"${phone}" listed another caller's ticket`);
    }
    const solvedOne = await ticketFrom(owner, { customerPhone: "+1 555 0999 004" }, null);
    await giveTo(solvedOne.id, expert2);
    assert.deepEqual(await markTicketSolvedForSession(asOwner, { ticketId: solvedOne.id, confirmedCustomerEmail: "" }), { ok: true });
    assert.equal((await ticketFrom(owner, { customerPhone: "+1 555 0999 004" })).assignedToUserId, expert1.id);
  });

  await check("repeat customer: a call from a caller with an open ticket goes to that ticket's person", async () => {
    const caller = "+1 555 0999 005";
    const earlier = await ticketFrom(owner, { customerPhone: caller }, null);
    await giveTo(earlier.id, expert2);
    const line = await createPhoneLine(owner.companyId, `pn-repeat-${runId}`);
    const callId = await saveTestCall(line.vapiPhoneNumberId, "User: Still no refund.\nAI: I'll pass this on.", caller);
    const reply = answer({ outcome: "needs_human", customer_issue: "Refund.", resolution_evidence: "", reason: "Refund.", ticket_subject: "Refund", category: "Repeat billing" });
    await analyzeCall(owner.companyId, callId, fakeModel(reply).ask);
    const [callTicket] = await db.select().from(tickets).where(eq(tickets.callId, callId));
    assert.deepEqual([callTicket.assignedToUserId, callTicket.assignedAutomatically], [expert2.id, true]);
  });

  await check("repeat customer: the ticket page lists the customer's other open tickets, in its own company only", async () => {
    const phone = "+1 555 0999 006";
    const openOne = await ticketFrom(owner, { customerPhone: phone });
    const solvedOne = await ticketFrom(owner, { customerPhone: phone });
    await markTicketSolvedForSession(asOwner, { ticketId: solvedOne.id, confirmedCustomerEmail: "" });
    const current = await ticketFrom(owner, { customerPhone: "+1 (555) 0999-006" });
    const other = await signUpTestOwner("repeat-list-other");
    const theirs = await ticketFrom(other, { customerPhone: phone }, null);
    const listed = await listOtherOpenTicketsFromCustomerForSession(asOwner, current.id);
    assert.deepEqual(listed.map((ticket) => ticket.ticketNumber), [openOne.ticketNumber]);
    assert.deepEqual(await listOtherOpenTicketsFromCustomerForSession(sessionFor(other), theirs.id), []);
    // Another company asking about our ticket learns nothing.
    assert.deepEqual(await listOtherOpenTicketsFromCustomerForSession(sessionFor(other), current.id), []);
    const noContact = await ticketFrom(owner, {});
    assert.deepEqual(await listOtherOpenTicketsFromCustomerForSession(asOwner, noContact.id), []);
  });
}
