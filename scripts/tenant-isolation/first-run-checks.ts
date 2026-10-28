// First-run and team checks (step 32): the dashboard points a new owner to
// Setup (until the company's first ticket) and anyone without categories to
// the Team page, from their own company's data only; the assign menu tells
// two teammates with the same name apart by email, and the ticket list's
// hover email is the company's person.

import assert from "node:assert/strict";
import { labelAssigneeOptions } from "@/lib/assignee-menu";
import { setCategoryArchivedForSession, setUserCategoriesForSession } from "@/services/categories";
import { getFirstRunHintsForSession } from "@/services/dashboard";
import { buildSetupChecklist, getSetupForSession } from "@/services/setup";
import { listAssigneeChoicesForSession } from "@/services/team";
import { assignTicketForSession, createTicketForCompany, listTicketsForSession } from "@/services/tickets";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";
import { addCategory, newTicket } from "./team-helpers";

export async function runFirstRunChecks() {
  await check("dashboard: an owner is pointed to Setup while checklist steps are left; members never are", async () => {
    const owner = await signUpTestOwner("first-run");
    const member = await addTeammate(owner, "first-run-member", "member");
    const hints = await getFirstRunHintsForSession(sessionFor(owner));
    const checklist = buildSetupChecklist(await getSetupForSession(sessionFor(owner)));
    assert.ok((hints.setupStepsLeft ?? 0) > 0, "a brand new company has nothing left to set up?");
    assert.equal(hints.setupStepsLeft, checklist.filter((item) => !item.done).length);
    assert.equal((await getFirstRunHintsForSession(sessionFor(member))).setupStepsLeft, null);
  });

  await check("dashboard: the Setup hint is first-run only: it ends with the company's first ticket, never with another company's", async () => {
    const owner = await signUpTestOwner("first-run-ticket");
    const other = await signUpTestOwner("first-run-ticket-other");
    await createTicketForCompany(other.companyId, newTicket());
    assert.ok(((await getFirstRunHintsForSession(sessionFor(owner))).setupStepsLeft ?? 0) > 0, "another company's ticket ended it");
    assert.equal((await getFirstRunHintsForSession(sessionFor(other))).setupStepsLeft, null);
    await createTicketForCompany(owner.companyId, newTicket());
    // Steps are still left (the phone line, for one, is never done here), but
    // the dashboard stops asking: the Setup page lists them.
    const checklist = buildSetupChecklist(await getSetupForSession(sessionFor(owner)));
    assert.ok(checklist.some((item) => !item.done), "every Setup step is done?");
    assert.equal((await getFirstRunHintsForSession(sessionFor(owner))).setupStepsLeft, null);
  });

  await check("dashboard: anyone who handles no active category is told to pick, until they do; other companies' categories don't count", async () => {
    const owner = await signUpTestOwner("first-run-categories");
    const member = sessionFor(await addTeammate(owner, "first-run-categories-member", "member"));
    await addCategory(await signUpTestOwner("first-run-categories-other"), "Another company's");
    // No category of its own yet: nothing to pick (the owner's Setup steps ask for one).
    assert.equal((await getFirstRunHintsForSession(member)).handlesNoCategory, false);
    const refunds = await addCategory(owner, "Refunds");
    await addCategory(owner, "Repairs");
    assert.equal((await getFirstRunHintsForSession(member)).handlesNoCategory, true);
    assert.equal((await getFirstRunHintsForSession(sessionFor(owner))).handlesNoCategory, true);
    assert.deepEqual(await setUserCategoriesForSession(member, { userId: member.userId, categoryIds: [refunds] }), { ok: true });
    assert.equal((await getFirstRunHintsForSession(member)).handlesNoCategory, false);
    // An archived category routes nothing, so handling only that one is handling none.
    assert.deepEqual(await setCategoryArchivedForSession(sessionFor(owner), { categoryId: refunds, archived: "true" }), { ok: true });
    assert.equal((await getFirstRunHintsForSession(member)).handlesNoCategory, true);
  });

  await check("assign menu: two teammates with the same name are told apart by email; other companies' people never show", async () => {
    const owner = await signUpTestOwner("same-name");
    // Every teammate the checks invite is called "Invited".
    const first = await addTeammate(owner, "same-name-first", "member");
    const second = await addTeammate(owner, "same-name-second", "member");
    const other = await signUpTestOwner("same-name-other");
    await addTeammate(other, "same-name-other-teammate", "member");
    const choices = await listAssigneeChoicesForSession(sessionFor(owner));
    assert.deepEqual(choices.map((person) => person.id).sort(), [owner.id, first.id, second.id].sort());
    const labels = new Map(labelAssigneeOptions(choices).map((option) => [option.id, option.label]));
    assert.equal(labels.get(first.id), `Invited (${first.email})`);
    assert.equal(labels.get(second.id), `Invited (${second.email})`);
    assert.equal(labels.get(owner.id), "Owner same-name");
    const people = [
      { id: "1", name: "Alex", email: "alex.one@example.test" },
      { id: "2", name: "ALEX", email: "alex.two@example.test" },
      { id: "3", name: "Sam", email: "sam@example.test" },
      { id: "4", name: "Sam (can't take tickets)", email: null },
    ];
    assert.deepEqual(labelAssigneeOptions(people).map((option) => option.label), [
      "Alex (alex.one@example.test)",
      "ALEX (alex.two@example.test)",
      "Sam",
      "Sam (can't take tickets)",
    ]);
  });

  await check("ticket list: the email shown on hover is the assignee's, from the same company", async () => {
    const owner = await signUpTestOwner("assignee-email");
    const expert = await addTeammate(owner, "assignee-email-expert", "member");
    const ticket = await createTicketForCompany(owner.companyId, newTicket());
    assert.deepEqual(await assignTicketForSession(sessionFor(owner), { ticketId: ticket.id, assigneeUserId: expert.id }), { ok: true });
    const listed = (await listTicketsForSession(sessionFor(owner))).find((row) => row.id === ticket.id);
    assert.equal(listed?.assigneeName, "Invited");
    assert.equal(listed?.assigneeEmail, expert.email);
    const unassigned = await createTicketForCompany(owner.companyId, newTicket());
    assert.equal((await listTicketsForSession(sessionFor(owner))).find((row) => row.id === unassigned.id)?.assigneeEmail, null);
  });
}
