// Step 27, Claude's answers and failures: a needs_human answer a little too
// long (or with a blank subject) keeps Claude's summary and category
// ("trimmed_output") while a "solved" one never gets that second chance; a
// failed request logs one fixed line with its class, which the call keeps and
// shows (without calling it Claude's decision); email tickets say why they
// have no AI summary; and a blank subject never costs a call its ticket.
// FAKE models only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, tickets } from "@/db/schema";
import { decideFromModelResult, type CallDecision } from "@/lib/call-brain/decision";
import { describeReason, isModelFailureReason } from "@/lib/call-brain/reasons";
import { buildTranscriptSlice } from "@/lib/call-brain/transcript-slice";
import { analyzeCall } from "@/services/call-analysis";
import { buildCallTicket } from "@/services/call-tickets";
import { getCallForSession } from "@/services/calls";
import { answer, SOLVED_TRANSCRIPT } from "./brain-guard-checks";
import { fakeModel, saveTestCall } from "./brain-test-calls";
import { assertRefusedByConstraint, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { receiveAndProcess, resendContent } from "./inbound-helpers";
import { addCategory } from "./team-helpers";

function needsHuman(fields: Record<string, unknown>) {
  return answer({ outcome: "needs_human", customer_issue: "Router drops.", resolution_evidence: "", reason: "Needs a technician.", ticket_subject: "Router drops", ...fields });
}

async function ticketOfCall(callId: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.callId, callId));
  return ticket;
}

export async function runBrainFailureChecks() {
  const slice = buildTranscriptSlice(SOLVED_TRANSCRIPT);
  const owner = await signUpTestOwner("brain-failures");
  const line = await createPhoneLine(owner.companyId, `pn-failures-${runId}`);

  await check("brain: a needs_human answer a little too long, or with a blank subject, keeps Claude's summary and category; 'solved' never does", async () => {
    const long = decideFromModelResult(needsHuman({ ticket_subject: "S".repeat(81), category: "Shipping" }), slice, ["Shipping"]);
    assert.deepEqual([long.outcome, long.reasonCode, long.category, long.ticketSubject], ["needs_human", "trimmed_output", "Shipping", "S".repeat(80)]);
    const longIssue = decideFromModelResult(needsHuman({ customer_issue: "i".repeat(501) }), slice, []);
    assert.deepEqual([longIssue.reasonCode, longIssue.customerIssue?.length], ["trimmed_output", 500]);
    const blank = decideFromModelResult(needsHuman({ ticket_subject: "   " }), slice, []);
    assert.deepEqual([blank.reasonCode, blank.ticketSubject, blank.customerIssue], ["trimmed_output", null, "Router drops."]);
    const solved = { outcome: "solved", customer_issue: "x", resolution_evidence: "that fixed it, thank you so much", reason: "x" };
    const neverSalvaged = [
      decideFromModelResult(answer({ ...solved, ticket_subject: "x".repeat(81) }), slice, []),
      decideFromModelResult(answer({ ...solved, ticket_subject: "   " }), slice, []),
      decideFromModelResult(needsHuman({ ticket_subject: "S".repeat(81), companyId: "other" }), slice, []),
      decideFromModelResult(needsHuman({ ticket_subject: "S".repeat(81), category: "Refunds" }), slice, ["Shipping"]),
    ];
    for (const decision of neverSalvaged) {
      assert.deepEqual([decision.outcome, decision.reasonCode, decision.category], ["needs_human", "invalid_output", null]);
    }
  });

  await check("brain: a trimmed answer's call ticket keeps Claude's subject, summary and category", async () => {
    await addCategory(owner, "Repairs");
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await analyzeCall(owner.companyId, callId, fakeModel(needsHuman({ ticket_subject: "R".repeat(90), category: "Repairs" })).ask);
    const ticket = await ticketOfCall(callId);
    assert.deepEqual([ticket.subject, ticket.category], ["R".repeat(80), "Repairs"]);
    assert.ok(ticket.description.startsWith("Router drops."), "Claude's summary was lost");
  });

  await check("brain: a failed Claude request logs one fixed line with its class; the call keeps it, ticket and page name it, not as Claude's decision", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const { logs } = await captureConsole(() => analyzeCall(owner.companyId, callId, fakeModel({ kind: "error", errorName: "AuthenticationError" }).ask));
    assert.deepEqual(logs, ["Claude call failed: AuthenticationError"]);
    const detail = await getCallForSession(sessionFor(owner), callId);
    assert.deepEqual([detail?.analysis.reasonCode, detail?.analysis.errorClass], ["model_error", "AuthenticationError"]);
    assert.equal(describeReason("model_error", "AuthenticationError"), "The AI could not be reached (AuthenticationError), so the call was escalated.");
    assert.deepEqual([isModelFailureReason("model_error"), isModelFailureReason("model_needs_human"), isModelFailureReason(null)], [true, false, false]);
    assert.match((await ticketOfCall(callId)).description, /Escalated because: The AI could not be reached \(AuthenticationError\)/);
    const oddName = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const oddLogs = await captureConsole(() => analyzeCall(owner.companyId, oddName, fakeModel({ kind: "error", errorName: `Bad name ${runId}` }).ask));
    assert.deepEqual(oddLogs.logs, ["Claude call failed: UnknownError"]);
    const refused = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const refusedLogs = await captureConsole(() => analyzeCall(owner.companyId, refused, fakeModel({ kind: "refused" }).ask));
    assert.deepEqual(refusedLogs.logs, ["Claude call failed: refused"]);
    const [refusedRow] = await db.select().from(calls).where(eq(calls.id, refused));
    assert.deepEqual([refusedRow.aiReasonCode, refusedRow.aiErrorClass], ["model_refused", null]);
  });

  await check("brain: an email ticket says why it has no AI summary; a failed request logs its class, a missing key nothing", async () => {
    const failed = await receiveAndProcess(owner, "triage-error", resendContent("triage-error"), fakeModel({ kind: "error", errorName: "NotFoundError" }).ask);
    assert.deepEqual(failed.logs, ["Claude call failed: NotFoundError"]);
    assert.match(failed.ticket?.description ?? "", /No AI summary or category: the AI could not be reached \(NotFoundError\)\./);
    const noKey = await receiveAndProcess(owner, "triage-no-key", resendContent("triage-no-key"), fakeModel({ kind: "unavailable" }).ask);
    assert.match(noKey.ticket?.description ?? "", /No AI summary or category: no Claude API key is set\./);
    assert.deepEqual(noKey.logs, []);
  });

  await check("brain: the database keeps only a class name where Claude's error is stored", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await assertRefusedByConstraint(
      db.update(calls).set({ aiErrorClass: "Error: the key sk-ant-123 is invalid" }).where(eq(calls.id, callId)),
      "calls_ai_error_class_is_a_name",
    );
  });

  await check("brain: a blank or over-long Claude subject never costs a call its ticket", async () => {
    const decision: CallDecision = { outcome: "needs_human", source: "model", reasonCode: "model_needs_human", customerIssue: "x", explanation: null, ticketSubject: "   ", category: null, resolutionEvidence: null };
    assert.equal(buildCallTicket(decision, null).subject, "Phone call needs follow-up");
    assert.equal(buildCallTicket({ ...decision, ticketSubject: "T".repeat(300) }, null).subject, "T".repeat(200));
  });
}
