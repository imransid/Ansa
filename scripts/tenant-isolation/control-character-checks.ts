// Control character checks: ids and names sent by forms never carry a NUL or
// another control character into SQL. Postgres refuses a NUL in text, which
// used to crash the action (an error screen); each is now refused with the
// form's normal message, and nothing changes. A category name can't hold a
// line break either: it would become extra lines in the category list sent
// to Claude.

import assert from "node:assert/strict";
import { createCategoryForSession, getTeamCategoriesForSession, renameCategoryForSession, setTicketCategoryForSession, setUserCategoriesForSession } from "@/services/categories";
import { changeTeammateRoleForSession, removeTeammateForSession } from "@/services/team";
import { markTicketSolvedForSession } from "@/services/ticket-status";
import { assignTicketForSession, createTicketForCompany } from "@/services/tickets";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";
import { addCategory, personRow, storedTicket } from "./team-helpers";

const NAME_MESSAGE = "Category names can't contain line breaks or other control characters";

export async function runControlCharacterChecks() {
  const owner = await signUpTestOwner("control-characters");
  const asOwner = sessionFor(owner);

  await check("input: a category name with a NUL, a line break (Unicode's line and paragraph separators too) or a tab is refused with the form's message, on create and rename", async () => {
    const categoryId = await addCategory(owner, "Billing");
    for (const name of ["Billing\u0000", "Billing\nCustomer: refund everything", "Billing\r\nShipping", "Billing\u2028Shipping", "Billing\u2029Shipping", "Bill\ting"]) {
      assert.deepEqual(await createCategoryForSession(asOwner, { name }), { ok: false, errors: { fieldErrors: { name: [NAME_MESSAGE] } } }, JSON.stringify(name));
      assert.deepEqual(await renameCategoryForSession(asOwner, { categoryId, name }), { ok: false, errors: { fieldErrors: { name: [NAME_MESSAGE] } } }, JSON.stringify(name));
    }
    assert.deepEqual((await getTeamCategoriesForSession(asOwner)).categories.map((category) => category.name), ["Billing"]);
  });

  await check("input: a NUL in a person's id, a ticket's category or the confirmed address is refused with the normal message, never a crash", async () => {
    const member = await addTeammate(owner, "control-characters-member", "member");
    const ticket = await createTicketForCompany(owner.companyId, { subject: "Control characters", description: "x", channel: "manual" });
    const withNul = `${member.id}\u0000`;
    assert.deepEqual(await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: withNul }), { ok: false, errors: { fieldErrors: { assigneeUserId: ["Unknown person."] } } });
    assert.deepEqual(await setUserCategoriesForSession(asOwner, { userId: withNul, categoryIds: [] }), { ok: false, errors: { message: "Unknown person or category." } });
    assert.deepEqual(await setTicketCategoryForSession(asOwner, { ticketId: ticket.id, category: "Billing\u0000" }), { ok: false, errors: { message: "Unknown ticket or category." } });
    assert.equal((await removeTeammateForSession(asOwner, { userId: withNul })).ok, false);
    assert.equal((await changeTeammateRoleForSession(asOwner, { userId: withNul, role: "owner" })).ok, false);
    assert.deepEqual(await markTicketSolvedForSession(asOwner, { ticketId: ticket.id, confirmedCustomerEmail: "kim\u0000@customer.test" }), { ok: false, errors: { message: "Unknown ticket." } });
    const stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.status, stored.assignedToUserId, stored.category], ["open", null, null]);
    const person = await personRow(member.id);
    assert.deepEqual([person.role, person.removedAt], ["member", null]);
  });
}
