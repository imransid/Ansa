// Ticket details checks (step 31): anyone in the company can change a
// ticket's subject and customer name, with the same limits as a new ticket;
// each field that really changes writes one history row naming who did it
// (never the text), and a re-save writes none; only the fields a person
// changed in the editor are saved, so a teammate's change made while it was
// open stays and is never recorded as theirs; another company changes and
// writes nothing; a subject is saved as one plain line; and the step 31
// history entries read as meant.

import assert from "node:assert/strict";
import { editTicketDetails } from "@/db/ticket-details";
import { describeTicketActivity, historyNamesItsCreator, type ActivityToDescribe } from "@/lib/ticket-history-text";
import { createTicketForCompany, editTicketDetailsForSession } from "@/services/tickets";
import { addTeammate, check, sessionFor, signUpTestOwner } from "./helpers";
import { historyRows, historySummary } from "./history-helpers";
import { storedTicket } from "./team-helpers";

const PHONE_SUBJECT = "Phone call needs follow-up";

type EditorFields = { subject: string; customerName: string };

// A new phone ticket opens in the editor like this (no name yet).
const NEW_PHONE_TICKET: EditorFields = { subject: PHONE_SUBJECT, customerName: "" };

// What the ticket page's editor sends: what it opened with, and what was saved.
function editorSave(ticketId: string, openedWith: EditorFields, saved: EditorFields) {
  return {
    ticketId,
    originalSubject: openedWith.subject,
    originalCustomerName: openedWith.customerName,
    subject: saved.subject,
    customerName: saved.customerName,
  };
}

export async function runTicketDetailsChecks() {
  const owner = await signUpTestOwner("details");
  const member = await addTeammate(owner, "details-member", "member");
  const other = await signUpTestOwner("details-other");
  const newPhoneTicket = () => createTicketForCompany(owner.companyId, { subject: PHONE_SUBJECT, description: "x", channel: "phone" });

  await check("ticket details: anyone in the company changes the subject and name; one row per field changed, none for a re-save", async () => {
    const ticket = await newPhoneTicket();
    const named = { subject: "Router drops every evening", customerName: "Dana Reyes" };
    const edit = editorSave(ticket.id, NEW_PHONE_TICKET, named);
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(member), edit), { ok: true });
    // The owner had the editor open too and saves the same: nothing to write.
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(owner), edit), { ok: true });
    let stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.subject, stored.customerName], [named.subject, named.customerName]);
    assert.deepEqual(await historySummary(ticket.id), [
      ["subject_changed", member.id, null, null],
      ["customer_name_changed", member.id, null, null],
    ]);
    // Blank clears the name: one row, by the owner.
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(owner), editorSave(ticket.id, named, { ...named, customerName: "  " })), { ok: true });
    stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.subject, stored.customerName], [named.subject, null]);
    assert.deepEqual((await historySummary(ticket.id)).at(-1), ["customer_name_changed", owner.id, null, null]);
    assert.equal((await historyRows(ticket.id)).length, 3);
  });

  await check("ticket details: only what the person changed is saved: a teammate's change made while the editor was open stays, and isn't recorded as theirs", async () => {
    const ticket = await newPhoneTicket();
    // The member opens the editor; meanwhile the owner changes the subject.
    const ownersSubject = "Router drops every evening";
    const ownersSave = editorSave(ticket.id, NEW_PHONE_TICKET, { ...NEW_PHONE_TICKET, subject: ownersSubject });
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(owner), ownersSave), { ok: true });
    // The member only adds the name; the subject box still shows the old subject.
    const membersSave = editorSave(ticket.id, NEW_PHONE_TICKET, { ...NEW_PHONE_TICKET, customerName: "Dana Reyes" });
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(member), membersSave), { ok: true });
    let stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.subject, stored.customerName], [ownersSubject, "Dana Reyes"]);
    assert.deepEqual(await historySummary(ticket.id), [
      ["subject_changed", owner.id, null, null],
      ["customer_name_changed", member.id, null, null],
    ]);
    // Saving an editor opened before both, without changing anything: nothing is written.
    const untouchedSave = editorSave(ticket.id, NEW_PHONE_TICKET, NEW_PHONE_TICKET);
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(member), untouchedSave), { ok: true });
    // Both change the subject: the later save wins and the history names
    // both; the editor's stale empty name box clears nothing.
    const membersSubject = "Router fixed, the modem is next";
    const membersSubjectSave = editorSave(ticket.id, NEW_PHONE_TICKET, { ...NEW_PHONE_TICKET, subject: membersSubject });
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(member), membersSubjectSave), { ok: true });
    stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.subject, stored.customerName], [membersSubject, "Dana Reyes"]);
    assert.deepEqual((await historySummary(ticket.id)).slice(2), [["subject_changed", member.id, null, null]]);
  });

  await check("ticket details: another company can't edit a ticket, and nothing is written", async () => {
    const ticket = await newPhoneTicket();
    const hijack = editorSave(ticket.id, NEW_PHONE_TICKET, { subject: "Hijacked", customerName: "Mallory" });
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(other), hijack), {
      ok: false,
      errors: { message: "That ticket was not found in your company." },
    });
    const directEdit = { openedWith: { subject: PHONE_SUBJECT, customerName: null }, saved: { subject: "Hijacked", customerName: "Mallory" } };
    assert.equal(await editTicketDetails(other.companyId, ticket.id, directEdit, other.id), "refused");
    const stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.subject, stored.customerName], [PHONE_SUBJECT, null]);
    assert.deepEqual(await historyRows(ticket.id), []);
  });

  await check("ticket details: the same limits as a new ticket, and a subject is saved as one plain line", async () => {
    const ticket = await newPhoneTicket();
    const refusals: [Record<string, unknown>, string][] = [
      [{ subject: "  " }, "subject"],
      [{ subject: "x".repeat(201) }, "subject"],
      [{ customerName: "x".repeat(201) }, "customerName"],
      [{ originalSubject: "  " }, "originalSubject"],
      [{ ticketId: "not-a-ticket" }, "ticketId"],
    ];
    for (const [fields, field] of refusals) {
      const save = { ...editorSave(ticket.id, NEW_PHONE_TICKET, { subject: "Fine", customerName: "" }), ...fields };
      const result = await editTicketDetailsForSession(sessionFor(member), save);
      assert.ok(!result.ok && result.errors.fieldErrors?.[field], `${JSON.stringify(fields)} was not refused on ${field}`);
    }
    assert.deepEqual(await historyRows(ticket.id), [], "a refused edit wrote history");
    const tricky = editorSave(ticket.id, NEW_PHONE_TICKET, { subject: "Invoice\r\nBcc: x@evil.test \u202Egpj.exe", customerName: "Ana\u200B Lee" });
    assert.deepEqual(await editTicketDetailsForSession(sessionFor(member), tricky), { ok: true });
    const stored = await storedTicket(ticket.id);
    assert.deepEqual([stored.subject, stored.customerName], ["Invoice Bcc: x@evil.test gpj.exe", "Ana Lee"]);
  });

  await check("history wording: the step 31 entries read as meant, and a ticket made in the app names its creator", async () => {
    const people = { actorUserId: "ana", actorName: "Ana", targetUserId: null, targetName: null, category: null };
    const cases: [ActivityToDescribe, string][] = [
      [{ ...people, kind: "created" }, "Ana created the ticket"],
      [{ ...people, kind: "escalated" }, "Ana escalated the call to a ticket: the AI had marked it solved"],
      [{ ...people, kind: "subject_changed" }, "Ana changed the subject"],
      [{ ...people, kind: "customer_name_changed" }, "Ana changed the customer's name"],
    ];
    for (const [activity, expected] of cases) {
      assert.equal(describeTicketActivity(activity), expected);
    }
    assert.equal(historyNamesItsCreator(["created", "routed"]), true);
    assert.equal(historyNamesItsCreator(["escalated"]), true);
    assert.equal(historyNamesItsCreator(["routed", "assigned"]), false);
  });
}
