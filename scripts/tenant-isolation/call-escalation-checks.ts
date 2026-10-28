// Call escalation checks (step 31): a call the AI marked solved can be
// escalated to exactly one ticket in its own company, routed and emailed,
// recording who escalated it, while ai_outcome and ai_reason_code keep what
// the AI decided. Another company can't escalate it; a needs_human or
// unanalyzed call can't be escalated; the database refuses an escalation
// that breaks those rules; the customer's sentence behind a "solved" is kept
// encrypted (and nothing for other calls); and escalating shares the
// creation limit. FAKE model only: nothing here calls the real API.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { escalateSolvedCall } from "@/db/call-escalation";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, tickets } from "@/db/schema";
import { analyzeCall } from "@/services/call-analysis";
import { escalateCallForSession } from "@/services/call-escalation";
import { buildEscalatedCallTicket } from "@/services/call-tickets";
import { getCallForSession, listCallsForSession } from "@/services/calls";
import { setUserCategoriesForSession } from "@/services/categories";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { answer, SOLVED_TRANSCRIPT, solvedAnswer } from "./brain-guard-checks";
import { fakeModel, saveTestCall } from "./brain-test-calls";
import { addTeammate, assertRefusedByConstraint, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { historySummary } from "./history-helpers";
import { addCategory, assignmentEmailCount } from "./team-helpers";

const BILLING = "Escalation billing";
const SECRET = `secret-router-words-${runId}`;
// The solved call of the brain checks, with words in it that must never reach a ticket.
const TRANSCRIPT = SOLVED_TRANSCRIPT.replace("keeps dropping", `(${SECRET}) keeps dropping`);

async function storedCall(callId: string) {
  const [call] = await db.select().from(calls).where(eq(calls.id, callId));
  return call;
}

async function ticketsForCall(callId: string) {
  return db.select().from(tickets).where(eq(tickets.callId, callId));
}

export async function runCallEscalationChecks() {
  const owner = await signUpTestOwner("escalate");
  const member = await addTeammate(owner, "escalate-member", "member");
  const expert = await addTeammate(owner, "escalate-expert", "member");
  const billingId = await addCategory(owner, BILLING);
  await setUserCategoriesForSession(sessionFor(expert), { userId: expert.id, categoryIds: [billingId] });
  const other = await signUpTestOwner("escalate-other");
  const line = await createPhoneLine(owner.companyId, `pn-escalate-${runId}`);
  let callerCount = 0;

  // A call the AI marked solved, each from its own caller: one caller's
  // calls count as one customer, whose open ticket would decide the routing.
  async function solvedCall(): Promise<string> {
    callerCount += 1;
    const callId = await saveTestCall(line.vapiPhoneNumberId, TRANSCRIPT, `+1 555 0320 ${String(callerCount).padStart(3, "0")}`);
    await analyzeCall(owner.companyId, callId, fakeModel(solvedAnswer("That fixed it, thank you so much.")).ask);
    return callId;
  }

  await check("escalation: a call the AI marked solved becomes one ticket in its company, routed and emailed, recording who escalated it", async () => {
    const callId = await solvedCall();
    const before = await storedCall(callId);
    assert.deepEqual([before.aiOutcome, before.aiReasonCode, (await ticketsForCall(callId)).length], ["solved", "model_solved", 0]);
    assert.equal((await getCallForSession(sessionFor(member), callId))?.analysis.canEscalate, true);

    const note = "The router still drops every evening: call her back.";
    const result = await escalateCallForSession(sessionFor(member), { callId, categoryId: billingId, note });
    assert.ok(result.ok, JSON.stringify(result));
    const created = await ticketsForCall(callId);
    assert.equal(created.length, 1);
    const [ticket] = created;
    assert.deepEqual(
      [ticket.ticketNumber, ticket.companyId, ticket.channel, ticket.category, ticket.assignedToUserId, ticket.assignedAutomatically],
      [result.ticketNumber, owner.companyId, "phone", BILLING, expert.id, true],
    );
    assert.equal(ticket.customerPhone, "+1 555 0320 001");
    assert.deepEqual(await historySummary(ticket.id), [
      ["escalated", member.id, null, null],
      ["routed", null, expert.id, BILLING],
    ]);
    assert.equal(await assignmentEmailCount(ticket.id), 1);
    assert.ok(ticket.description.includes("Router drops connection.") && ticket.description.includes(note), ticket.description);
    for (const callText of [SECRET, "thank you so much"]) {
      assert.ok(!ticket.description.includes(callText), `"${callText}" from the transcript is on the ticket`);
    }

    const page = await getCallForSession(sessionFor(owner), callId);
    assert.deepEqual([page?.analysis.canEscalate, page?.ticketNumber, page?.escalation?.byName], [false, ticket.ticketNumber, "Invited"]);
    const listed = (await listCallsForSession(sessionFor(owner))).find((call) => call.id === callId);
    assert.ok(listed?.escalatedAt, "the calls list doesn't mark it escalated");
  });

  await check("escalation: the AI's verdict stays exactly as it was decided; only who and when are added", async () => {
    const callId = await solvedCall();
    const before = await storedCall(callId);
    assert.equal((await escalateCallForSession(sessionFor(owner), { callId, categoryId: "", note: "" })).ok, true);
    const after = await storedCall(callId);
    const verdict = (call: typeof before) => [call.analysisStatus, call.aiOutcome, call.aiDecisionSource, call.aiReasonCode, call.aiModel, call.decidedAt?.toISOString()];
    assert.deepEqual(verdict(after), verdict(before));
    assert.equal(after.aiEvidenceEncrypted, before.aiEvidenceEncrypted);
    assert.equal(after.escalatedByUserId, owner.id);
    assert.ok(after.escalatedAt, "no time recorded");
  });

  await check("escalation: one ticket per call: escalating again, or twice at once, makes no second ticket", async () => {
    const callId = await solvedCall();
    const input = { callId, categoryId: billingId, note: "" };
    const results = await Promise.all([escalateCallForSession(sessionFor(member), input), escalateCallForSession(sessionFor(owner), input)]);
    assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
    assert.equal((await escalateCallForSession(sessionFor(owner), input)).ok, false);
    const created = await ticketsForCall(callId);
    assert.equal(created.length, 1);
    const [winner, loser] = results[0].ok ? [member, owner] : [owner, member];
    assert.equal((await storedCall(callId)).escalatedByUserId, winner.id);
    // What the refused one's page shows once the action refreshes it
    // (app/actions/calls.ts): no form, the winner's ticket and name.
    const loserPage = await getCallForSession(sessionFor(loser), callId);
    const winnerName = winner === member ? "Invited" : "Owner escalate";
    assert.deepEqual(
      [loserPage?.analysis.canEscalate, loserPage?.ticketNumber, loserPage?.escalation?.byName],
      [false, created[0].ticketNumber, winnerName],
    );
  });

  await check("escalation: another company can't escalate the call, see it, or get a ticket from it", async () => {
    const callId = await solvedCall();
    const refused = await escalateCallForSession(sessionFor(other), { callId, categoryId: "", note: "" });
    assert.deepEqual(refused, { ok: false, errors: { message: "That call was not found in your company." } });
    const ticket = buildEscalatedCallTicket(null, null, { categoryId: null, note: null });
    assert.equal(await escalateSolvedCall(other.companyId, callId, other.id, ticket), undefined);
    assert.equal((await ticketsForCall(callId)).length, 0);
    assert.equal((await storedCall(callId)).escalatedAt, null);
    assert.equal(await getCallForSession(sessionFor(other), callId), null);
  });

  await check("escalation: only a call the AI marked solved: a needs_human call keeps its one ticket, an unanalyzed call gets none", async () => {
    const needsHuman = await saveTestCall(line.vapiPhoneNumberId, TRANSCRIPT, "+1 555 0320 900");
    const needsHumanAnswer = { outcome: "needs_human", customer_issue: "Router drops.", resolution_evidence: "", reason: "Unclear.", ticket_subject: "Router" };
    await analyzeCall(owner.companyId, needsHuman, fakeModel(answer(needsHumanAnswer)).ask);
    const pending = await saveTestCall(line.vapiPhoneNumberId, TRANSCRIPT, "+1 555 0320 901");
    for (const [callId, ticketCount] of [[needsHuman, 1], [pending, 0]] as const) {
      assert.equal((await getCallForSession(sessionFor(owner), callId))?.analysis.canEscalate, false);
      assert.equal((await escalateCallForSession(sessionFor(owner), { callId, categoryId: "", note: "" })).ok, false);
      assert.equal((await ticketsForCall(callId)).length, ticketCount);
      assert.equal((await storedCall(callId)).escalatedAt, null);
    }
  });

  await check("escalation: the database refuses one on a call the AI didn't mark solved, by someone of another company, or without its time", async () => {
    const pending = await saveTestCall(line.vapiPhoneNumberId, TRANSCRIPT, "+1 555 0320 902");
    const solved = await solvedCall();
    await assertRefusedByConstraint(
      db.update(calls).set({ escalatedByUserId: owner.id, escalatedAt: new Date() }).where(eq(calls.id, pending)),
      "calls_escalated_only_when_ai_solved",
    );
    await assertRefusedByConstraint(
      db.update(calls).set({ escalatedByUserId: other.id, escalatedAt: new Date() }).where(eq(calls.id, solved)),
      "calls_escalator_in_same_company_fk",
    );
    await assertRefusedByConstraint(
      db.update(calls).set({ escalatedByUserId: owner.id }).where(eq(calls.id, solved)),
      "calls_escalation_fields_together",
    );
  });

  await check("evidence: a solved call keeps the customer's own sentence, encrypted, and the call page shows it; other calls keep none", async () => {
    // Claude's copy differs in case and punctuation: the transcript's sentence is what is kept.
    const solved = await saveTestCall(line.vapiPhoneNumberId, TRANSCRIPT, "+1 555 0320 903");
    await analyzeCall(owner.companyId, solved, fakeModel(solvedAnswer("THAT FIXED IT, thank you so much")).ask);
    const solvedRow = await storedCall(solved);
    assert.ok(solvedRow.aiEvidenceEncrypted && !solvedRow.aiEvidenceEncrypted.includes("fixed"), "the sentence is not encrypted");
    assert.equal((await getCallForSession(sessionFor(member), solved))?.analysis.evidence, "That fixed it, thank you so much.");
    // A paraphrase is no proof: the call needs a human, and nothing is kept.
    const unproven = await saveTestCall(line.vapiPhoneNumberId, TRANSCRIPT, "+1 555 0320 904");
    await analyzeCall(owner.companyId, unproven, fakeModel(solvedAnswer("It is fixed now, thanks")).ask);
    const unprovenRow = await storedCall(unproven);
    assert.deepEqual([unprovenRow.aiOutcome, unprovenRow.aiEvidenceEncrypted], ["needs_human", null]);
    assert.equal((await getCallForSession(sessionFor(member), unproven))?.analysis.evidence, null);
    await assertRefusedByConstraint(
      db.update(calls).set({ aiEvidenceEncrypted: solvedRow.aiEvidenceEncrypted }).where(eq(calls.id, unproven)),
      "calls_ai_evidence_only_when_solved",
    );
  });

  await check("escalation: it shares the creation limit with new tickets typed in", async () => {
    const flooder = await addTeammate(owner, "escalate-flooder", "member");
    for (let attempt = 0; attempt < RATE_LIMITS.ticketCreationsPerUser.maxAttempts; attempt++) {
      await isOverRateLimit("ticket-creations", flooder.id, RATE_LIMITS.ticketCreationsPerUser);
    }
    const callId = await solvedCall();
    const refused = await escalateCallForSession(sessionFor(flooder), { callId, categoryId: "", note: "" });
    assert.deepEqual(refused, { ok: false, errors: { message: "Too many new tickets. Try again in a few minutes." } });
    assert.deepEqual([(await ticketsForCall(callId)).length, (await storedCall(callId)).escalatedAt], [0, null]);
  });
}
