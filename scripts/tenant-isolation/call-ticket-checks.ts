// Ticket-from-call checks (step 8): every "needs_human" gets exactly one
// ticket in the call's company, a solved call gets none, the ticket holds a
// short summary but never the transcript, and companies stay apart.
// Uses a FAKE model only. None of these checks call the real, paid API.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { tickets } from "@/db/schema";
import { analyzeCall } from "@/services/call-analysis";
import { getCallForSession } from "@/services/calls";
import { getTicketForSession, listTicketsForSession } from "@/services/tickets";
import { answer, SOLVED_TRANSCRIPT, solvedAnswer } from "./brain-guard-checks";
import { fakeModel, saveTestCall, TEST_CALLER } from "./brain-test-calls";
import { assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

function needsHumanAnswer() {
  return answer({
    outcome: "needs_human",
    customer_issue: "Customer wants a replacement for a cracked screen.",
    resolution_evidence: "",
    reason: "The agent cannot arrange replacements.",
    ticket_subject: "Replacement for a cracked screen",
  });
}

async function ticketsForCall(callId: string) {
  return db.select().from(tickets).where(eq(tickets.callId, callId));
}

export async function runCallTicketChecks(ownerA: TestUser, ownerB: TestUser) {
  const line = await createPhoneLine(ownerA.companyId, `pn-tickets-${runId}`);
  const secretWords = `secret-call-words-${runId}`;
  const transcript = `User: My screen is cracked, ${secretWords}.\nAI: I can't arrange replacements, I'll pass this on.`;

  await check("tickets: 'needs a human' creates exactly one ticket in the call's company", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, transcript);
    const { logs } = await captureConsole(() => analyzeCall(ownerA.companyId, callId, fakeModel(needsHumanAnswer()).ask));
    assert.deepEqual(logs, [], "something was logged");
    const created = await ticketsForCall(callId);
    assert.equal(created.length, 1);
    const [ticket] = created;
    assert.equal(ticket.companyId, ownerA.companyId);
    assert.equal(ticket.subject, "Replacement for a cracked screen");
    assert.equal(ticket.channel, "phone");
    assert.equal(ticket.customerPhone, TEST_CALLER);
    assert.equal(ticket.customerEmail, null, "an email was invented");
    assert.equal(ticket.status, "open");
    assert.equal(ticket.assignedToUserId, null);
    assert.ok(ticket.description.includes("Customer wants a replacement for a cracked screen."));
    assert.ok(!ticket.description.includes(secretWords), "transcript text copied onto the ticket");
    const call = await getCallForSession(sessionFor(ownerA), callId);
    assert.equal(call?.ticketNumber, ticket.ticketNumber);
  });

  await check("tickets: a solved call gets no ticket", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await analyzeCall(ownerA.companyId, callId, fakeModel(solvedAnswer("that fixed it, thank you so much")).ask);
    assert.equal((await ticketsForCall(callId)).length, 0);
  });

  await check("tickets: rule escalations, invalid answers and crashes get a ticket too", async () => {
    const silent = await saveTestCall(line.vapiPhoneNumberId, "AI: Hello? AI: Is anyone there?");
    const invalid = await saveTestCall(line.vapiPhoneNumberId, transcript);
    const crashed = await saveTestCall(line.vapiPhoneNumberId, transcript);
    const unusedModel = fakeModel(needsHumanAnswer());
    await analyzeCall(ownerA.companyId, silent, unusedModel.ask);
    assert.equal(unusedModel.calls, 0, "the model was asked about a silent call");
    await analyzeCall(ownerA.companyId, invalid, fakeModel(answer({ outcome: "solved" })).ask);
    await captureConsole(() => analyzeCall(ownerA.companyId, crashed, fakeModel(() => { throw new RangeError("boom"); }).ask));
    for (const callId of [silent, invalid, crashed]) {
      const [ticket] = await ticketsForCall(callId);
      assert.ok(ticket, "no ticket");
      assert.equal(ticket.subject, "Phone call needs follow-up");
      assert.match(ticket.description, /^Escalated because: /);
    }
  });

  await check("tickets: a call can never get a second ticket", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, transcript);
    const model = fakeModel(needsHumanAnswer());
    await Promise.all([analyzeCall(ownerA.companyId, callId, model.ask), analyzeCall(ownerA.companyId, callId, model.ask)]);
    assert.equal((await ticketsForCall(callId)).length, 1);
    const [existing] = await ticketsForCall(callId);
    await assertRefusedByConstraint(
      db.insert(tickets).values({ ...existing, id: undefined, ticketNumber: existing.ticketNumber + 1000 }),
      "tickets_call_id_unique",
    );
  });

  await check("tickets: the database refuses a ticket linked to another company's call", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, transcript);
    await assertRefusedByConstraint(
      db.insert(tickets).values({
        companyId: ownerB.companyId,
        ticketNumber: 999_000,
        subject: "Smuggled",
        description: "Pointing at company A's call",
        channel: "phone",
        callId,
      }),
      "tickets_call_in_same_company_fk",
    );
  });

  await check("tickets: another company never sees call tickets or the call behind them", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, transcript);
    await analyzeCall(ownerA.companyId, callId, fakeModel(needsHumanAnswer()).ask);
    const [ticket] = await ticketsForCall(callId);
    const ticketsForB = await listTicketsForSession(sessionFor(ownerB));
    assert.ok(!ticketsForB.some((listed) => listed.id === ticket.id));
    const sameNumberForB = await getTicketForSession(sessionFor(ownerB), ticket.ticketNumber);
    assert.notEqual(sameNumberForB?.id, ticket.id);
    assert.equal(await getCallForSession(sessionFor(ownerB), callId), null);
  });
}
