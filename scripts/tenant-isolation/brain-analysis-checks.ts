// Call brain analysis checks (database, fake model): a decision is stored only
// on the call and company it was asked about, a call is analyzed once at a
// time, notes are encrypted (also when "Analyze now" sends the id in
// capitals), a transcript that can't be decrypted escalates, and nothing from
// the prompt or answer is logged.
// Every check uses a FAKE model. None of them call the real, paid API.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, companies } from "@/db/schema";
import { encryptText } from "@/lib/encryption";
import { callTranscriptContext } from "@/lib/encryption-contexts";
import { analyzeCall, analyzeCallForSession } from "@/services/call-analysis";
import { getCallForSession } from "@/services/calls";
import { SOLVED_TRANSCRIPT, solvedAnswer } from "./brain-guard-checks";
import { fakeModel, saveTestCall, TEST_CALLER } from "./brain-test-calls";
import { assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

async function row(callId: string) {
  const [stored] = await db.select().from(calls).where(eq(calls.id, callId));
  return stored;
}

export async function runBrainAnalysisChecks(ownerA: TestUser, ownerB: TestUser) {
  const line = await createPhoneLine(ownerA.companyId, `pn-brain-${runId}`);
  const [companyA] = await db.select().from(companies).where(eq(companies.id, ownerA.companyId));

  await check("brain: a verified 'solved' is stored on that call, with encrypted notes", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const model = fakeModel(solvedAnswer("that fixed it, thank you so much"));
    assert.equal(await analyzeCall(ownerA.companyId, callId, model.ask), "decided");
    const stored = await row(callId);
    assert.equal(stored.aiOutcome, "solved");
    assert.equal(stored.aiDecisionSource, "model");
    assert.ok(stored.aiIssueEncrypted?.startsWith("v1:") && !stored.aiIssueEncrypted.includes("Router"));
    const detail = await getCallForSession(sessionFor(ownerA), callId);
    assert.equal(detail?.analysis.issue, "Router drops connection.");
    // Already decided: not analyzed again.
    assert.equal(await analyzeCall(ownerA.companyId, callId, model.ask), "not-claimed");
    assert.equal(model.calls, 1);
  });

  await check("brain: 'Analyze now' with the call id in capitals stores notes the call page can still decrypt", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const model = fakeModel(solvedAnswer("that fixed it, thank you so much"));
    assert.deepEqual(await analyzeCallForSession(sessionFor(ownerA), { callId: callId.toUpperCase() }, model.ask), { ok: true });
    const { logs, result: detail } = await captureConsole(() => getCallForSession(sessionFor(ownerA), callId));
    assert.deepEqual([detail?.analysis.issue, detail?.analysis.evidence, logs], ["Router drops connection.", "That fixed it, thank you so much.", []]);
  });

  await check("brain: the prompt is only the slice, without company, caller or ids", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const model = fakeModel(solvedAnswer("that fixed it, thank you so much"));
    await analyzeCall(ownerA.companyId, callId, model.ask);
    const prompt = model.prompts[0];
    const stored = await row(callId);
    for (const secret of [TEST_CALLER, companyA.name, ownerA.companyId, callId, stored.vapiCallId, line.vapiPhoneNumberId]) {
      assert.ok(!prompt.includes(secret), `prompt contains ${secret}`);
    }
  });

  await check("brain: another company cannot analyze the call, and nothing changes", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const model = fakeModel(solvedAnswer("that fixed it, thank you so much"));
    assert.equal(await analyzeCall(ownerB.companyId, callId, model.ask), "not-claimed");
    // Through the page action too. (B's claim fails, so the real model is never reached.)
    assert.equal((await analyzeCallForSession(sessionFor(ownerB), { callId })).ok, false);
    assert.equal(model.calls, 0);
    assert.equal((await row(callId)).analysisStatus, "pending");
  });

  await check("brain: two analyses at once ask the model only once; a stale one can be redone", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const model = fakeModel(solvedAnswer("that fixed it, thank you so much"));
    const results = await Promise.all([analyzeCall(ownerA.companyId, callId, model.ask), analyzeCall(ownerA.companyId, callId, model.ask)]);
    assert.deepEqual(results.sort(), ["decided", "not-claimed"]);
    assert.equal(model.calls, 1);

    const staleId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await db.update(calls).set({ analysisStatus: "analyzing", analysisStartedAt: new Date() }).where(eq(calls.id, staleId));
    assert.equal(await analyzeCall(ownerA.companyId, staleId, model.ask), "not-claimed");
    await db.update(calls).set({ analysisStartedAt: new Date(Date.now() - 10 * 60 * 1000) }).where(eq(calls.id, staleId));
    assert.equal(await analyzeCall(ownerA.companyId, staleId, model.ask), "decided");
  });

  await check("brain: a crash escalates the call and logs only the error type", async () => {
    const marker = `marker-${runId}`;
    const callId = await saveTestCall(line.vapiPhoneNumberId, `User: ${marker} please help\nAI: one moment`);
    const model = fakeModel(() => {
      throw new TypeError(`boom while reading User: ${marker}`);
    });
    const { result, logs } = await captureConsole(() => analyzeCall(ownerA.companyId, callId, model.ask));
    assert.equal(result, "decided");
    assert.deepEqual(logs, ["Call analysis failed: TypeError"]);
    const stored = await row(callId);
    assert.equal(stored.aiOutcome, "needs_human");
    assert.equal(stored.aiReasonCode, "analysis_error");
  });

  await check("brain: a transcript that can't be decrypted escalates without asking the model, logging one fixed line", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    // Encrypted for another record, as after a DATA_ENCRYPTION_KEY mix-up.
    const unreadable = encryptText(SOLVED_TRANSCRIPT, callTranscriptContext(ownerB.companyId, `other-${runId}`));
    await db.update(calls).set({ transcriptEncrypted: unreadable }).where(eq(calls.id, callId));
    const model = fakeModel(solvedAnswer("that fixed it, thank you so much"));
    const { result, logs } = await captureConsole(() => analyzeCall(ownerA.companyId, callId, model.ask));
    assert.equal(result, "decided");
    assert.equal(model.calls, 0);
    assert.deepEqual(logs, ["Could not decrypt stored text: check DATA_ENCRYPTION_KEY"]);
    const stored = await row(callId);
    assert.deepEqual([stored.aiOutcome, stored.aiReasonCode], ["needs_human", "transcript_unreadable"]);
  });

  await check("brain: a valid answer and a failed one log nothing about the call", async () => {
    const marker = `quiet-${runId}`;
    const answerWithMarker = { kind: "ok" as const, outputText: `{"oops": "${marker}"}`, usage: { inputTokens: 1, outputTokens: 1 } };
    for (const reply of [solvedAnswer("that fixed it, thank you so much"), answerWithMarker]) {
      const callId = await saveTestCall(line.vapiPhoneNumberId, `${SOLVED_TRANSCRIPT}\nUser: ${marker}`);
      const { logs } = await captureConsole(() => analyzeCall(ownerA.companyId, callId, fakeModel(reply).ask));
      assert.deepEqual(logs, []);
    }
  });

  await check("brain: the database refuses a 'decided' call without its decision fields", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    await assertRefusedByConstraint(
      db.update(calls).set({ analysisStatus: "decided" }).where(eq(calls.id, callId)),
      "calls_decision_fields_match_status",
    );
  });
}
