// Checks for saves that must change nothing, and for solved tickets (step 30):
// saving the assignee a routed ticket already has keeps it "routed", emails
// nobody again and writes no history; saving the category an open, unassigned
// ticket already has still routes it; a solved ticket is never routed and its
// new assignee never emailed; after a routed ticket's category changes, the
// page never claims routing followed the new one; and every kind of history
// entry reads as meant.

import assert from "node:assert/strict";
import { describeAssignment, describeTicketActivity, type ActivityToDescribe } from "@/lib/ticket-history-text";
import { setTicketCategoryForSession, setUserCategoriesForSession } from "@/services/categories";
import { getTicketHistoryForSession } from "@/services/ticket-history";
import { markTicketSolvedForSession } from "@/services/ticket-status";
import { assignTicketForSession, createTicketForCompany, getTicketForSession } from "@/services/tickets";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";
import { historyRows } from "./history-helpers";
import { addCategory, assignmentEmailCount, newTicket, storedTicket } from "./team-helpers";

export async function runTicketChangeChecks() {
  const owner = await signUpTestOwner("unchanged");
  const asOwner = sessionFor(owner);
  const expert = await addTeammate(owner, "unchanged-expert", "member");
  const member = await addTeammate(owner, "unchanged-member", "member");
  const billingId = await addCategory(owner, "Unchanged billing");
  await addCategory(owner, "Unchanged shipping");
  await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [billingId] });

  await check("unchanged: saving the assignee a routed ticket already has keeps it routed, emails nobody again, writes no history", async () => {
    const ticket = await createTicketForCompany(owner.companyId, newTicket("Unchanged billing"));
    assert.equal(ticket.assignedToUserId, expert.id);
    assert.equal(await assignmentEmailCount(ticket.id), 1);
    for (const person of [owner, member, expert]) {
      assert.deepEqual(await assignTicketForSession(sessionFor(person), { ticketId: ticket.id, assigneeUserId: expert.id }), { ok: true });
    }
    const stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.assignedToUserId, stored.assignedAutomatically, stored.routedToUserId], [expert.id, true, expert.id]);
    assert.equal(await assignmentEmailCount(ticket.id), 1, "the assignee was emailed again");
    assert.deepEqual((await historyRows(ticket.id)).map((row) => row.kind), ["routed"]);
    // A real change is still a person's, and the new assignee is told.
    assert.deepEqual(await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: member.id }), { ok: true });
    assert.equal((await storedTicket(ticket.id)).assignedAutomatically, false);
    assert.equal(await assignmentEmailCount(ticket.id), 2);
  });

  await check("re-saved category: an open ticket taken off its assignee goes back to routing, with only routing's row, and is emailed", async () => {
    const ticket = await createTicketForCompany(owner.companyId, newTicket("Unchanged billing"));
    assert.deepEqual(await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: "" }), { ok: true });
    // Saved twice: the second save finds it assigned again, so nothing happens.
    for (let save = 0; save < 2; save++) {
      const sameCategory = { ticketId: ticket.id, category: "Unchanged billing" };
      assert.deepEqual(await setTicketCategoryForSession(sessionFor(member), sameCategory), { ok: true });
    }
    const stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.assignedToUserId, stored.assignedAutomatically], [expert.id, true]);
    assert.deepEqual((await historyRows(ticket.id)).map((row) => row.kind), ["routed", "unassigned", "routed"]);
    assert.equal(await assignmentEmailCount(ticket.id), 2, "the expert was not told the ticket is theirs again");
  });

  await check("solved: setting a category routes nothing and emails nobody; assigning one is saved but emails nobody", async () => {
    const ticket = await createTicketForCompany(owner.companyId, newTicket());
    assert.deepEqual(await markTicketSolvedForSession(asOwner, { ticketId: ticket.id, confirmedCustomerEmail: "" }), { ok: true });
    assert.deepEqual(await setTicketCategoryForSession(asOwner, { ticketId: ticket.id, category: "Unchanged billing" }), { ok: true });
    assert.equal((await storedTicket(ticket.id)).assignedToUserId, null, "routing took a solved ticket");
    assert.deepEqual(await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: expert.id }), { ok: true });
    assert.equal((await storedTicket(ticket.id)).assignedToUserId, expert.id);
    assert.equal(await assignmentEmailCount(ticket.id), 0, "someone was emailed about a solved ticket");
    assert.deepEqual((await historyRows(ticket.id)).map((row) => row.kind), ["solved", "category_set", "assigned"]);
  });

  await check("recategorised: after a routed ticket's category changes, nothing claims routing followed the new one", async () => {
    const ticket = await createTicketForCompany(owner.companyId, newTicket("Unchanged billing"));
    assert.deepEqual(await setTicketCategoryForSession(sessionFor(member), { ticketId: ticket.id, category: "Unchanged shipping" }), { ok: true });
    const stored = await getTicketForSession(asOwner, ticket.ticketNumber);
    assert.ok(stored);
    // It stays with its expert (routing never takes a ticket from someone),
    // and the "Assigned to" line names no category.
    assert.equal(stored.assignedToUserId, expert.id);
    assert.equal(describeAssignment(stored), "Invited, routed automatically");
    const { entries } = await getTicketHistoryForSession(asOwner, ticket.id);
    assert.deepEqual(entries.map(describeTicketActivity), [
      "Routed automatically to Invited for the category Unchanged billing",
      "Invited set the category to Unchanged shipping",
    ]);
  });

  await check("history wording: every kind of entry reads as meant, with the app's own changes told apart", async () => {
    const people = { actorUserId: "ana", actorName: "Ana", targetUserId: "ben", targetName: "Ben", category: null };
    const byTheApp = { ...people, actorUserId: null, actorName: null };
    const cases: [ActivityToDescribe, string][] = [
      [{ ...people, kind: "note" }, "Ana added a note"],
      [{ ...people, kind: "assigned" }, "Ana assigned it to Ben"],
      [{ ...people, kind: "assigned", targetUserId: "ana", targetName: "Ana" }, "Ana took the ticket"],
      [{ ...people, kind: "unassigned" }, "Ana took it off Ben"],
      [{ ...people, kind: "unassigned", targetUserId: "ana", targetName: "Ana" }, "Ana gave the ticket up"],
      [{ ...byTheApp, kind: "unassigned" }, "Taken off Ben automatically: they can no longer take tickets"],
      [{ ...byTheApp, kind: "unassigned", targetUserId: null, targetName: null }, "Taken off its assignee automatically: their account was deleted"],
      [{ ...byTheApp, kind: "routed", category: "Billing" }, "Routed automatically to Ben for the category Billing"],
      [{ ...byTheApp, kind: "routed" }, "Routed automatically to Ben, who had this customer's other open ticket"],
      [{ ...people, kind: "solved" }, "Ana marked it solved"],
      [{ ...people, kind: "closed_without_email" }, "Ana closed it without emailing the customer"],
      [{ ...people, kind: "reopened" }, "Ana reopened it"],
      [{ ...people, kind: "category_set", category: "Billing" }, "Ana set the category to Billing"],
      [{ ...people, kind: "category_set" }, "Ana removed the category"],
      [{ ...people, kind: "customer_email_set" }, "Ana set the customer's email"],
    ];
    for (const [activity, expected] of cases) {
      assert.equal(describeTicketActivity(activity), expected);
    }
    assert.equal(describeAssignment({ assigneeName: null, assignedAutomatically: null }), "Nobody yet");
    assert.equal(describeAssignment({ assigneeName: "Ben", assignedAutomatically: false }), "Ben, assigned by a person");
  });
}
