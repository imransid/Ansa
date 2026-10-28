// Backlog routing checks (step 29): when someone starts handling a category,
// or an owner restores one, the company's open tickets that waited,
// unassigned, in it are routed in the same transaction and whoever gets one is
// emailed. Routing never takes a ticket from someone and leaves solved tickets
// and other companies alone. The Setup checklist counts the people who handle
// no active category (confirmed, not removed), in the session's company only.

import assert from "node:assert/strict";
import { setCategoryArchivedForSession, setUserCategoriesForSession } from "@/services/categories";
import { getSetupForSession } from "@/services/setup";
import { removeTeammateForSession } from "@/services/team";
import { markTicketSolvedForSession } from "@/services/ticket-status";
import { assignTicketForSession, createTicketForCompany } from "@/services/tickets";
import { addTeammate, check, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { addCategory, assignmentEmailCount, joinWithoutConfirming, newTicket, storedTicket } from "./team-helpers";

function createIn(owner: TestUser, category: string) {
  return createTicketForCompany(owner.companyId, newTicket(category));
}

async function peopleWithoutCategories(owner: TestUser): Promise<number> {
  return (await getSetupForSession(sessionFor(owner))).peopleWithoutCategories;
}

export async function runBacklogRoutingChecks() {
  const owner = await signUpTestOwner("backlog");
  const asOwner = sessionFor(owner);
  const expert1 = await addTeammate(owner, "backlog-1", "member");
  const expert2 = await addTeammate(owner, "backlog-2", "member");

  await check("backlog: ticking a category routes the open tickets waiting in it and emails whoever gets them", async () => {
    const waitingId = await addCategory(owner, "Backlog waiting");
    // Nobody handles the category yet, so these wait, unassigned.
    const waiting = [await createIn(owner, "Backlog waiting"), await createIn(owner, "Backlog waiting")];
    assert.deepEqual(waiting.map((ticket) => ticket.assignedToUserId), [null, null]);
    const someonesTicket = await createIn(owner, "Backlog waiting");
    await assignTicketForSession(asOwner, { ticketId: someonesTicket.id, assigneeUserId: owner.id });
    const solvedTicket = await createIn(owner, "Backlog waiting");
    await markTicketSolvedForSession(asOwner, { ticketId: solvedTicket.id, confirmedCustomerEmail: "" });
    // Another company, with a waiting ticket in a category of the same name.
    const other = await signUpTestOwner("backlog-other");
    await addCategory(other, "Backlog waiting");
    const theirs = await createIn(other, "Backlog waiting");

    assert.deepEqual(await setUserCategoriesForSession(sessionFor(expert1), { userId: expert1.id, categoryIds: [waitingId] }), { ok: true });
    for (const ticket of waiting) {
      const routed = await storedTicket(ticket.id);
      assert.deepEqual([routed.assignedToUserId, routed.assignedAutomatically, routed.routedToUserId], [expert1.id, true, expert1.id]);
      assert.equal(await assignmentEmailCount(ticket.id), 1, "the new assignee was not emailed once");
    }
    assert.equal((await storedTicket(someonesTicket.id)).assignedToUserId, owner.id, "routing took a ticket from someone");
    assert.equal((await storedTicket(solvedTicket.id)).assignedToUserId, null, "a solved ticket was routed");
    assert.equal((await storedTicket(theirs.id)).assignedToUserId, null, "another company's ticket was routed");
  });

  await check("backlog: restoring a category routes the open tickets that came in while it was archived", async () => {
    const restoredId = await addCategory(owner, "Backlog restored");
    await setUserCategoriesForSession(sessionFor(expert2), { userId: expert2.id, categoryIds: [restoredId] });
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: restoredId, archived: "true" }), { ok: true });
    const waiting = await createIn(owner, "Backlog restored");
    assert.equal(waiting.assignedToUserId, null, "a ticket was routed by an archived category");
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: restoredId, archived: "false" }), { ok: true });
    const routed = await storedTicket(waiting.id);
    assert.deepEqual([routed.assignedToUserId, routed.assignedAutomatically], [expert2.id, true]);
    assert.equal(await assignmentEmailCount(waiting.id), 1);
  });

  await check("setup: the checklist counts people who handle no active category, never unconfirmed, removed or another company's", async () => {
    const lead = await signUpTestOwner("checklist");
    const member = await addTeammate(lead, "checklist-member", "member");
    await joinWithoutConfirming(lead, "checklist-unconfirmed");
    const leaver = await addTeammate(lead, "checklist-leaver", "member");
    assert.deepEqual(await removeTeammateForSession(sessionFor(lead), { userId: leaver.id }), { ok: true });
    const categoryId = await addCategory(lead, "Checklist category");
    assert.equal(await peopleWithoutCategories(lead), 2, "the owner and the member");
    await setUserCategoriesForSession(sessionFor(member), { userId: member.id, categoryIds: [categoryId] });
    await setUserCategoriesForSession(sessionFor(lead), { userId: lead.id, categoryIds: [categoryId] });
    assert.equal(await peopleWithoutCategories(lead), 0);
    // An archived category routes nothing, so it doesn't count.
    await setCategoryArchivedForSession(sessionFor(lead), { categoryId, archived: "true" });
    assert.equal(await peopleWithoutCategories(lead), 2);
    await setCategoryArchivedForSession(sessionFor(lead), { categoryId, archived: "false" });
    assert.equal(await peopleWithoutCategories(lead), 0);
    // The backlog company's people are counted there, not here.
    assert.equal(await peopleWithoutCategories(owner), 1, "only the backlog owner handles nothing");
  });
}
