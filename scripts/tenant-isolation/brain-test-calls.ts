// Shared by the call brain checks: a fake model (so no check ever calls the
// real, paid API) and a way to save a realistic test call.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DecisionAsker, ModelResult } from "@/lib/call-brain/model-output";
import { endOfCallReportSchema } from "@/lib/validation/vapi";
import { saveEndOfCallReport } from "@/services/calls";
import { buildSampleEndOfCallReport } from "../vapi-sample";
import { runId } from "./helpers";

export const TEST_CALLER = "+1 555 0177";

// A stand-in for adapters/claude.ts that records what it was asked.
export function fakeModel(reply: ModelResult | (() => never)) {
  const fake = { calls: 0, prompts: [] as string[], ask: (async () => reply) as DecisionAsker };
  fake.ask = async (_system, prompt) => {
    fake.calls += 1;
    fake.prompts.push(prompt);
    return typeof reply === "function" ? reply() : reply;
  };
  return fake;
}

// Saves a call through the same code path as the Vapi webhook and returns its id.
export async function saveTestCall(phoneNumberId: string, transcript: string): Promise<string> {
  const vapiCallId = `brain-${runId}-${randomUUID()}`;
  const report = endOfCallReportSchema.parse(
    buildSampleEndOfCallReport({ callId: vapiCallId, phoneNumberId, callerNumber: TEST_CALLER, transcript }),
  );
  const saved = await saveEndOfCallReport(report);
  assert.equal(saved.outcome, "saved");
  return saved.outcome === "saved" ? saved.callId : "";
}
