// Routing checks (step 10): a new ticket goes to the least-loaded expert for
// its category in the SAME company (ties: whoever joined first), routing never
// takes a ticket from someone, and every assignment records whether it was
// automatic or by a person. Uses a FAKE model only; no paid API calls.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { tickets } from "@/db/schema";
import { analyzeCall } from "@/services/call-analysis";
import {
  createCategoryForSession,
  getTeamCategoriesForSession,
  setCategoryArchivedForSession,
  setTicketCategoryForSession,
  setUserCategoriesForSession,
} from "@/services/categories";
import { assignTicketForSession, createTicketForCompany } from "@/services/tickets";
import { answer } from "./brain-guard-checks";
import { fakeModel, saveTestCall } from "./brain-test-calls";
import { addTeammate, assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

function newTicket(category?: string) {
  return { subject: "Routing check", description: "x", channel: "phone", category };
}

async function stored(ticketId: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  return ticket;
}

export async function runRoutingChecks(ownerA: TestUser, ownerB: TestUser) {
  const asOwnerA = sessionFor(ownerA);
  // Joined in this order: expert1 first, so expert1 wins ties.
  const expert1 = await addTeammate(ownerA, "router-1", "member");
  const expert2 = await addTeammate(ownerA, "router-2", "member");
  await createCategoryForSession(asOwnerA, { name: "Support" });
  await createCategoryForSession(asOwnerA, { name: "Nobody handles this" });
  const { categories } = await getTeamCategoriesForSession(asOwnerA);
  const supportId = categories.find((category) => category.name === "Support")!.id;
  for (const expert of [expert1, expert2]) {
    await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [supportId] });
  }

  await check("routing: a tie goes to whoever joined first, then to whoever has fewer open tickets", async () => {
    const { result: first, logs } = await captureConsole(() => createTicketForCompany(ownerA.companyId, newTicket("Support")));
    // The dev outbox announces the assignment email (file name only); nothing else may be printed.
    assert.deepEqual(logs.filter((line) => !line.startsWith("[dev email] Not sent.")), []);
    assert.equal(first.assignedToUserId, expert1.id);
    assert.equal(first.assignedAutomatically, true);
    assert.equal(first.routedToUserId, expert1.id);
    const second = await createTicketForCompany(ownerA.companyId, newTicket("Support"));
    assert.equal(second.assignedToUserId, expert2.id, "expert1 already had one open ticket");
    const third = await createTicketForCompany(ownerA.companyId, newTicket("Support"));
    assert.equal(third.assignedToUserId, expert1.id, "one each: the tie goes to expert1 again");
  });

  await check("routing: no category, nobody handling it, or an archived category leaves it unassigned", async () => {
    for (const category of [undefined, "Nobody handles this"]) {
      const ticket = await createTicketForCompany(ownerA.companyId, newTicket(category));
      assert.equal(ticket.assignedToUserId, null);
      assert.equal(ticket.assignedAutomatically, null);
    }
    await setCategoryArchivedForSession(asOwnerA, { categoryId: supportId, archived: "true" });
    const archived = await createTicketForCompany(ownerA.companyId, newTicket("Support"));
    assert.equal(archived.assignedToUserId, null);
    await setCategoryArchivedForSession(asOwnerA, { categoryId: supportId, archived: "false" });
  });

  await check("routing: never picks another company's expert, even for the same category name", async () => {
    const { categories: categoriesB } = await getTeamCategoriesForSession(sessionFor(ownerB));
    const billingB = categoriesB.find((category) => category.name === "Billing")!.id;
    await setUserCategoriesForSession(sessionFor(ownerB), { userId: ownerB.id, categoryIds: [billingB] });
    const ticket = await createTicketForCompany(ownerA.companyId, newTicket("Billing"));
    assert.ok(ticket.assignedToUserId, "company A has Billing experts from the category checks");
    assert.notEqual(ticket.assignedToUserId, ownerB.id);
  });

  await check("routing: setting a category routes an unassigned ticket but never takes one from someone", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, newTicket());
    assert.equal((await setTicketCategoryForSession(asOwnerA, { ticketId: ticket.id, category: "Support" })).ok, true);
    const routed = await stored(ticket.id);
    assert.ok(routed.assignedToUserId === expert1.id || routed.assignedToUserId === expert2.id);
    assert.equal(routed.assignedAutomatically, true);
    await assignTicketForSession(asOwnerA, { ticketId: ticket.id, assigneeUserId: ownerA.id });
    await setTicketCategoryForSession(asOwnerA, { ticketId: ticket.id, category: "Nobody handles this" });
    await setTicketCategoryForSession(asOwnerA, { ticketId: ticket.id, category: "Support" });
    const kept = await stored(ticket.id);
    assert.equal(kept.assignedToUserId, ownerA.id, "routing took the ticket from its assignee");
    assert.equal(kept.assignedAutomatically, false);
  });

  await check("routing: a person's (re)assignment is recorded as manual, and the original pick is kept", async () => {
    const ticket = await createTicketForCompany(ownerA.companyId, newTicket("Support"));
    const routedTo = ticket.assignedToUserId;
    await assignTicketForSession(asOwnerA, { ticketId: ticket.id, assigneeUserId: ownerA.id });
    let current = await stored(ticket.id);
    assert.equal(current.assignedAutomatically, false);
    assert.equal(current.routedToUserId, routedTo, "the original routing pick was lost");
    await assignTicketForSession(asOwnerA, { ticketId: ticket.id, assigneeUserId: "" });
    current = await stored(ticket.id);
    assert.equal(current.assignedAutomatically, null);
    assert.equal(current.routedToUserId, routedTo);
    await assertRefusedByConstraint(
      db.update(tickets).set({ assignedToUserId: ownerA.id }).where(eq(tickets.id, ticket.id)),
      "tickets_assignment_origin_matches_assignee",
    );
  });

  await check("routing: a call ticket gets Claude's category and is routed; an invented category is not", async () => {
    const line = await createPhoneLine(ownerA.companyId, `pn-routing-${runId}`);
    const transcript = "User: I was charged twice.\nAI: I can't refund that, I'll pass it on.";
    const needsHuman = (category: string) =>
      answer({ outcome: "needs_human", customer_issue: "Double charge.", resolution_evidence: "", reason: "Needs a refund.", ticket_subject: "Double charge", category });
    const routedCall = await saveTestCall(line.vapiPhoneNumberId, transcript);
    const model = fakeModel(needsHuman("Support"));
    await analyzeCall(ownerA.companyId, routedCall, model.ask);
    assert.ok(model.prompts[0].includes("- Support"), "categories were not offered to the model");
    const [routedTicket] = await db.select().from(tickets).where(eq(tickets.callId, routedCall));
    assert.equal(routedTicket.category, "Support");
    assert.equal(routedTicket.assignedAutomatically, true);

    const inventedCall = await saveTestCall(line.vapiPhoneNumberId, transcript);
    await analyzeCall(ownerA.companyId, inventedCall, fakeModel(needsHuman("Refunds desk")).ask);
    const [inventedTicket] = await db.select().from(tickets).where(eq(tickets.callId, inventedCall));
    assert.equal(inventedTicket.category, null);
    assert.equal(inventedTicket.assignedToUserId, null);
  });
}
