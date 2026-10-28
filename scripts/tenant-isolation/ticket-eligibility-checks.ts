// Who can take tickets (step 23): routing, manual assignment, the assignee
// menu, categories, assignment emails and reopening all skip people who were
// removed or never confirmed their email. Saving someone's categories keeps
// their links to archived categories, so a restored category routes again.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tickets, userCategories } from "@/db/schema";
import { notifyAssignee } from "@/services/assignment-notifications";
import { getTeamCategoriesForSession, setCategoryArchivedForSession, setUserCategoriesForSession } from "@/services/categories";
import { listAssigneeChoicesForSession, removeTeammateForSession } from "@/services/team";
import { markTicketSolvedForSession, reopenTicketForSession } from "@/services/ticket-status";
import { assignTicketForSession, createTicketForCompany } from "@/services/tickets";
import { addTeammate, check, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { addCategory, assignmentEmailCount, joinWithoutConfirming, newTicket, storedTicket } from "./team-helpers";

async function categoryLinksOf(owner: TestUser, userId: string): Promise<string[]> {
  const { links } = await getTeamCategoriesForSession(sessionFor(owner));
  return links.filter((link) => link.userId === userId).map((link) => link.categoryId).sort();
}

export async function runTicketEligibilityChecks() {
  await check("eligibility: routing, assigning and categories skip removed and unconfirmed people", async () => {
    const owner = await signUpTestOwner("eligibility");
    const asOwner = sessionFor(owner);
    const expert = await addTeammate(owner, "eligibility-expert", "member");
    const removed = await addTeammate(owner, "eligibility-removed", "member");
    const unconfirmed = await joinWithoutConfirming(owner, "eligibility-unconfirmed");
    const categoryId = await addCategory(owner, "Eligibility");
    assert.deepEqual(await removeTeammateForSession(asOwner, { userId: removed.id }), { ok: true });
    for (const personId of [removed.id, unconfirmed.id]) {
      assert.equal((await setUserCategoriesForSession(asOwner, { userId: personId, categoryIds: [categoryId] })).ok, false);
      const ticket = await createTicketForCompany(owner.companyId, newTicket());
      assert.equal((await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: personId })).ok, false);
      assert.equal((await storedTicket(ticket.id)).assignedToUserId, null);
    }
    // Links left from before (set straight in the database) don't make routing pick them...
    await db.insert(userCategories).values([
      { companyId: owner.companyId, userId: removed.id, categoryId },
      { companyId: owner.companyId, userId: unconfirmed.id, categoryId },
    ]);
    assert.equal((await createTicketForCompany(owner.companyId, newTicket("Eligibility"))).assignedToUserId, null);
    // ...while someone who can take tickets is picked as usual.
    assert.deepEqual(await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [categoryId] }), { ok: true });
    assert.equal((await createTicketForCompany(owner.companyId, newTicket("Eligibility"))).assignedToUserId, expert.id);
    // The "Assigned to" menu lists only people who can take tickets.
    const choices = (await listAssigneeChoicesForSession(asOwner)).map((person) => person.id).sort();
    assert.deepEqual(choices, [owner.id, expert.id].sort());
  });

  await check("eligibility: a removed or unconfirmed person gets no assignment email, even for a ticket left on them", async () => {
    const owner = await signUpTestOwner("eligibility-email");
    const removed = await addTeammate(owner, "eligibility-email-removed", "member");
    const unconfirmed = await joinWithoutConfirming(owner, "eligibility-email-unconfirmed");
    assert.deepEqual(await removeTeammateForSession(sessionFor(owner), { userId: removed.id }), { ok: true });
    for (const personId of [removed.id, unconfirmed.id]) {
      const ticket = await createTicketForCompany(owner.companyId, newTicket());
      await db.update(tickets).set({ assignedToUserId: personId, assignedAutomatically: false }).where(eq(tickets.id, ticket.id));
      await notifyAssignee({ companyId: owner.companyId, ticketId: ticket.id, assigneeUserId: personId, assignedByUserId: owner.id });
      assert.equal(await assignmentEmailCount(ticket.id), 0);
    }
  });

  await check("eligibility: reopening a solved ticket of someone since removed routes it again", async () => {
    const owner = await signUpTestOwner("eligibility-reopen");
    const asOwner = sessionFor(owner);
    const leaver = await addTeammate(owner, "eligibility-reopen-leaver", "member");
    const stayer = await addTeammate(owner, "eligibility-reopen-stayer", "member");
    const categoryId = await addCategory(owner, "Reopen check");
    await setUserCategoriesForSession(asOwner, { userId: leaver.id, categoryIds: [categoryId] });
    const ticket = await createTicketForCompany(owner.companyId, newTicket("Reopen check"));
    assert.equal(ticket.assignedToUserId, leaver.id);
    assert.deepEqual(await markTicketSolvedForSession(sessionFor(leaver), { ticketId: ticket.id, confirmedCustomerEmail: "" }), { ok: true });
    assert.deepEqual(await removeTeammateForSession(asOwner, { userId: leaver.id }), { ok: true });
    assert.equal((await storedTicket(ticket.id)).assignedToUserId, leaver.id, "a solved ticket keeps its assignee");
    await setUserCategoriesForSession(asOwner, { userId: stayer.id, categoryIds: [categoryId] });
    const emailsBefore = await assignmentEmailCount(ticket.id);
    assert.deepEqual(await reopenTicketForSession(asOwner, { ticketId: ticket.id }), { ok: true });
    const reopened = await storedTicket(ticket.id);
    assert.deepEqual(
      [reopened.status, reopened.assignedToUserId, reopened.assignedAutomatically, reopened.routedToUserId],
      ["open", stayer.id, true, leaver.id],
    );
    assert.equal(await assignmentEmailCount(ticket.id), emailsBefore + 1);
    // An ordinary reopen keeps its assignee and emails nobody.
    assert.deepEqual(await markTicketSolvedForSession(sessionFor(stayer), { ticketId: ticket.id, confirmedCustomerEmail: "" }), { ok: true });
    assert.deepEqual(await reopenTicketForSession(asOwner, { ticketId: ticket.id }), { ok: true });
    assert.equal((await storedTicket(ticket.id)).assignedToUserId, stayer.id);
    assert.equal(await assignmentEmailCount(ticket.id), emailsBefore + 1);
  });

  await check("categories: saving someone's categories keeps links to archived ones, so a restored category routes to them", async () => {
    const owner = await signUpTestOwner("archived-links");
    const asOwner = sessionFor(owner);
    const expert = await addTeammate(owner, "archived-links-expert", "member");
    const billingId = await addCategory(owner, "Archived billing");
    const shippingId = await addCategory(owner, "Archived shipping");
    const asExpert = sessionFor(expert);
    await setUserCategoriesForSession(asExpert, { userId: expert.id, categoryIds: [billingId, shippingId] });
    await setCategoryArchivedForSession(asOwner, { categoryId: billingId, archived: "true" });
    // The Team page only shows active categories, so this save sends Shipping alone.
    assert.deepEqual(await setUserCategoriesForSession(asExpert, { userId: expert.id, categoryIds: [shippingId] }), { ok: true });
    await setCategoryArchivedForSession(asOwner, { categoryId: billingId, archived: "false" });
    assert.deepEqual(await categoryLinksOf(owner, expert.id), [billingId, shippingId].sort());
    assert.equal((await createTicketForCompany(owner.companyId, newTicket("Archived billing"))).assignedToUserId, expert.id);
    // Unticking an active category still removes it.
    assert.deepEqual(await setUserCategoriesForSession(asExpert, { userId: expert.id, categoryIds: [billingId] }), { ok: true });
    assert.deepEqual(await categoryLinksOf(owner, expert.id), [billingId]);
  });
}
