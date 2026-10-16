// Call brain analysis checks (database, fake model): a decision is stored only
// on the call and company it was asked about, a call is analyzed once at a
// time, notes are encrypted, and nothing from the prompt or answer is logged.
// Every check uses a FAKE model. None of them call the real, paid API.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, companies } from "@/db/schema";
import type { DecisionAsker, ModelResult } from "@/lib/call-brain/model-output";
import { endOfCallReportSchema } from "@/lib/validation/vapi";
import { analyzeCall, analyzeCallForSession } from "@/services/call-analysis";
import { getCallForSession, saveEndOfCallReport } from "@/services/calls";
import { buildSampleEndOfCallReport } from "../vapi-sample";
import { SOLVED_TRANSCRIPT, solvedAnswer } from "./brain-guard-checks";
import { assertRefusedByConstraint, captureConsole, check, runId, sessionFor, type TestUser } from "./helpers";

const CALLER = "+1 555 0177";

function fakeModel(reply: ModelResult | (() => never)) {
  const fake = { calls: 0, prompts: [] as string[], ask: (async () => reply) as DecisionAsker };
  fake.ask = async (_system, prompt) => {
    fake.calls += 1;
    fake.prompts.push(prompt);
    return typeof reply === "function" ? reply() : reply;
  };
  return fake;
}

async function saveTestCall(phoneNumberId: string, transcript: string): Promise<string> {
  const vapiCallId = `brain-${runId}-${randomUUID()}`;
  const report = endOfCallReportSchema.parse(buildSampleEndOfCallReport({ callId: vapiCallId, phoneNumberId, callerNumber: CALLER, transcript }));
  const saved = await saveEndOfCallReport(report);
  assert.equal(saved.outcome, "saved");
  return saved.outcome === "saved" ? saved.callId : "";
}

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

  await check("brain: the prompt is only the slice, without company, caller or ids", async () => {
    const callId = await saveTestCall(line.vapiPhoneNumberId, SOLVED_TRANSCRIPT);
    const model = fakeModel(solvedAnswer("that fixed it, thank you so much"));
    await analyzeCall(ownerA.companyId, callId, model.ask);
    const prompt = model.prompts[0];
    const stored = await row(callId);
    for (const secret of [CALLER, companyA.name, ownerA.companyId, callId, stored.vapiCallId, line.vapiPhoneNumberId]) {
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
