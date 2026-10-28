// Ticket history checks (step 30): every way a ticket changes writes exactly
// one history row, with who did it (nobody for routing and the app itself);
// saving what a ticket already has, or a refused change, writes none; routing
// records what it followed, also for call and email tickets and for tickets
// that waited until someone picked their category or it was restored; and
// removing a teammate or reopening their ticket records the app taking it off
// them. FAKE model only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { tickets } from "@/db/schema";
import { analyzeCall } from "@/services/call-analysis";
import { setCategoryArchivedForSession, setTicketCategoryForSession, setUserCategoriesForSession } from "@/services/categories";
import { removeTeammateForSession } from "@/services/team";
import { closeTicketWithoutEmailForSession, markTicketSolvedForSession, reopenTicketForSession } from "@/services/ticket-status";
import { assignTicketForSession, createTicketForCompany, setCustomerEmailForSession } from "@/services/tickets";
import { userIdsWithEmail } from "./account-helpers";
import { answer } from "./brain-guard-checks";
import { fakeModel, saveTestCall } from "./brain-test-calls";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { historyRows, historySummary } from "./history-helpers";
import { receiveAndProcess, resendContent } from "./inbound-helpers";
import { addCategory, joinWithoutConfirming, newTicket } from "./team-helpers";

const BILLING = "History billing";

export async function runTicketHistoryChecks() {
  const owner = await signUpTestOwner("history");
  const asOwner = sessionFor(owner);
  const member = await addTeammate(owner, "history-member", "member");
  const expert = await addTeammate(owner, "history-expert", "member");
  const billingId = await addCategory(owner, BILLING);
  await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [billingId] });

  await check("history: each change writes exactly one row with who did it; re-saving the assignee or category writes none", async () => {
    const ticket = await createTicketForCompany(owner.companyId, newTicket());
    const address = `history-${runId}@customer.test`;
    // Each call twice: the second saves what the ticket already has.
    for (let save = 0; save < 2; save++) {
      assert.deepEqual(await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: member.id }), { ok: true });
    }
    for (let save = 0; save < 2; save++) {
      assert.deepEqual(await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: "" }), { ok: true });
    }
    for (let save = 0; save < 2; save++) {
      assert.deepEqual(await setTicketCategoryForSession(asOwner, { ticketId: ticket.id, category: BILLING }), { ok: true });
    }
    // Entering the same address again is a change: it records who entered it last.
    for (const person of [member, owner]) {
      const emailInput = { ticketId: ticket.id, customerEmail: address, confirmed: "yes" };
      assert.deepEqual(await setCustomerEmailForSession(sessionFor(person), emailInput), { ok: true });
    }
    assert.deepEqual(await markTicketSolvedForSession(sessionFor(expert), { ticketId: ticket.id, confirmedCustomerEmail: address }), { ok: true });
    assert.deepEqual(await reopenTicketForSession(asOwner, { ticketId: ticket.id }), { ok: true });
    assert.deepEqual(await closeTicketWithoutEmailForSession(sessionFor(member), { ticketId: ticket.id }), { ok: true });
    assert.deepEqual(await historySummary(ticket.id), [
      ["assigned", owner.id, member.id, null],
      ["unassigned", owner.id, member.id, null],
      ["category_set", owner.id, null, BILLING],
      ["routed", null, expert.id, BILLING],
      ["customer_email_set", member.id, null, null],
      ["customer_email_set", owner.id, null, null],
      ["solved", expert.id, null, null],
      ["reopened", owner.id, null, null],
      ["closed_without_email", member.id, null, null],
    ]);
  });

  await check("history: a change another company tries, or one the rules refuse, writes nothing", async () => {
    const other = await signUpTestOwner("history-other");
    const asOther = sessionFor(other);
    const ticket = await createTicketForCompany(owner.companyId, newTicket());
    // "" and null match what the ticket already has: still refused, never "unchanged", for another company.
    const attempts = [
      await assignTicketForSession(asOther, { ticketId: ticket.id, assigneeUserId: other.id }),
      await assignTicketForSession(asOther, { ticketId: ticket.id, assigneeUserId: "" }),
      await setTicketCategoryForSession(asOther, { ticketId: ticket.id, category: "" }),
      await setCustomerEmailForSession(asOther, { ticketId: ticket.id, customerEmail: `other-${runId}@customer.test`, confirmed: "yes" }),
      await markTicketSolvedForSession(asOther, { ticketId: ticket.id, confirmedCustomerEmail: "" }),
      await closeTicketWithoutEmailForSession(asOther, { ticketId: ticket.id }),
      await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: other.id }),
      await setTicketCategoryForSession(asOwner, { ticketId: ticket.id, category: "Not a category" }),
      await reopenTicketForSession(asOwner, { ticketId: ticket.id }),
    ];
    assert.deepEqual(attempts.map((result) => result.ok), attempts.map(() => false));
    assert.deepEqual(await historyRows(ticket.id), []);
  });

  await check("history: routing records what it followed, the category or the customer's other open ticket, with no actor", async () => {
    const phone = "+1 555 0300 001";
    const first = await createTicketForCompany(owner.companyId, { ...newTicket(BILLING), customerPhone: phone });
    assert.deepEqual(await historySummary(first.id), [["routed", null, expert.id, BILLING]]);
    await assignTicketForSession(asOwner, { ticketId: first.id, assigneeUserId: member.id });
    const second = await createTicketForCompany(owner.companyId, { ...newTicket(BILLING), customerPhone: phone });
    assert.deepEqual(await historySummary(second.id), [["routed", null, member.id, null]]);
  });

  await check("history: a call ticket and an email ticket record their routing in the transaction that creates them", async () => {
    const line = await createPhoneLine(owner.companyId, `pn-history-${runId}`);
    const callId = await saveTestCall(line.vapiPhoneNumberId, "User: I was charged twice.\nAI: I'll pass this on.", "+1 555 0300 002");
    const triage = { customer_issue: "Charged twice.", ticket_subject: "Double charge", category: BILLING };
    await analyzeCall(owner.companyId, callId, fakeModel(answer({ ...triage, outcome: "needs_human", resolution_evidence: "", reason: "Refund." })).ask);
    const [callTicket] = await db.select().from(tickets).where(eq(tickets.callId, callId));
    assert.deepEqual(await historySummary(callTicket.id), [["routed", null, expert.id, BILLING]]);
    const { ticket: emailTicket } = await receiveAndProcess(owner, "history-email", resendContent("history-email"), fakeModel(answer(triage)).ask);
    assert.ok(emailTicket, "the email became no ticket");
    assert.deepEqual(await historySummary(emailTicket.id), [["routed", null, expert.id, BILLING]]);
  });

  await check("history: routing waiting tickets when someone picks categories, or an owner restores one, writes one routed row each", async () => {
    const picker = await addTeammate(owner, "history-picker", "member");
    const pickedId = await addCategory(owner, "History picked");
    const restoredId = await addCategory(owner, "History restored");
    // Nobody handles "History picked" yet, so this one waits, unassigned.
    const waitingForPicker = await createTicketForCompany(owner.companyId, newTicket("History picked"));
    const pickerCategories = { userId: picker.id, categoryIds: [pickedId, restoredId] };
    assert.deepEqual(await setUserCategoriesForSession(sessionFor(picker), pickerCategories), { ok: true });
    assert.deepEqual(await historySummary(waitingForPicker.id), [["routed", null, picker.id, "History picked"]]);
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: restoredId, archived: "true" }), { ok: true });
    const waitingForRestore = await createTicketForCompany(owner.companyId, newTicket("History restored"));
    assert.deepEqual(await historyRows(waitingForRestore.id), [], "an archived category routed a ticket");
    assert.deepEqual(await setCategoryArchivedForSession(asOwner, { categoryId: restoredId, archived: "false" }), { ok: true });
    assert.deepEqual(await historySummary(waitingForRestore.id), [["routed", null, picker.id, "History restored"]]);
  });

  await check("history: removing a teammate records the app taking their tickets off, then the routing", async () => {
    const leaver = await addTeammate(owner, "history-leaver", "member");
    const held = await createTicketForCompany(owner.companyId, newTicket());
    await assignTicketForSession(asOwner, { ticketId: held.id, assigneeUserId: leaver.id });
    await setTicketCategoryForSession(asOwner, { ticketId: held.id, category: BILLING });
    assert.deepEqual(await removeTeammateForSession(asOwner, { userId: leaver.id }), { ok: true });
    assert.deepEqual((await historySummary(held.id)).slice(-2), [
      ["unassigned", null, leaver.id, null],
      ["routed", null, expert.id, BILLING],
    ]);
  });

  await check("history: deleting an account that never confirmed keeps the rows that named it, without its name", async () => {
    const unconfirmed = await joinWithoutConfirming(owner, "history-unconfirmed");
    // Set straight in the database, as tickets left on such an account before step 23.
    const unassignedEarlier = await createTicketForCompany(owner.companyId, newTicket());
    const stillTheirs = await createTicketForCompany(owner.companyId, newTicket());
    for (const ticket of [unassignedEarlier, stillTheirs]) {
      await db.update(tickets).set({ assignedToUserId: unconfirmed.id, assignedAutomatically: false }).where(eq(tickets.id, ticket.id));
    }
    await assignTicketForSession(asOwner, { ticketId: unassignedEarlier.id, assigneeUserId: "" });
    assert.deepEqual(await historySummary(unassignedEarlier.id), [["unassigned", owner.id, unconfirmed.id, null]]);
    assert.deepEqual(await removeTeammateForSession(asOwner, { userId: unconfirmed.id }), { ok: true });
    assert.deepEqual(await userIdsWithEmail(unconfirmed.email), [], "the account was not deleted");
    assert.deepEqual(await historySummary(unassignedEarlier.id), [["unassigned", owner.id, null, null]]);
    assert.deepEqual(await historySummary(stillTheirs.id), [["unassigned", null, null, null]]);
  });

  await check("history: reopening a removed teammate's solved ticket records the reopen, the app taking it off them, and the routing", async () => {
    const leaver = await addTeammate(owner, "history-reopen-leaver", "member");
    const ticket = await createTicketForCompany(owner.companyId, newTicket());
    await assignTicketForSession(asOwner, { ticketId: ticket.id, assigneeUserId: leaver.id });
    await setTicketCategoryForSession(asOwner, { ticketId: ticket.id, category: BILLING });
    await markTicketSolvedForSession(sessionFor(leaver), { ticketId: ticket.id, confirmedCustomerEmail: "" });
    assert.deepEqual(await removeTeammateForSession(asOwner, { userId: leaver.id }), { ok: true });
    assert.deepEqual(await reopenTicketForSession(asOwner, { ticketId: ticket.id }), { ok: true });
    assert.deepEqual(await historySummary(ticket.id), [
      ["assigned", owner.id, leaver.id, null],
      ["category_set", owner.id, null, BILLING],
      ["solved", leaver.id, null, null],
      ["reopened", owner.id, null, null],
      ["unassigned", null, leaver.id, null],
      ["routed", null, expert.id, BILLING],
    ]);
  });
}
