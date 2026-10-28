// Shared by the call brain checks: a fake model (so no check ever calls the
// real, paid API) and a way to save a realistic test call.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ModelAsker, ModelRequest, ModelResult } from "@/lib/model-request";
import { endOfCallReportSchema } from "@/lib/validation/vapi";
import { saveEndOfCallReport } from "@/services/calls";
import { buildSampleEndOfCallReport } from "../vapi-sample";
import { runId } from "./helpers";

export const TEST_CALLER = "+1 555 0177";

// A stand-in for adapters/claude.ts that records what it was asked.
export function fakeModel(reply: ModelResult | (() => never)) {
  const fake = { calls: 0, prompts: [] as string[], requests: [] as ModelRequest[], ask: (async () => reply) as ModelAsker };
  fake.ask = async (request) => {
    fake.calls += 1;
    fake.prompts.push(request.prompt);
    fake.requests.push(request);
    return typeof reply === "function" ? reply() : reply;
  };
  return fake;
}

// Saves a call through the same code path as the Vapi webhook and returns its
// id. Calls from one caller count as one customer (step 29: their tickets go
// to the same expert), so checks that need unrelated calls pass their own number.
export async function saveTestCall(phoneNumberId: string, transcript: string, callerNumber = TEST_CALLER): Promise<string> {
  const vapiCallId = `brain-${runId}-${randomUUID()}`;
  const report = endOfCallReportSchema.parse(
    buildSampleEndOfCallReport({ callId: vapiCallId, phoneNumberId, callerNumber, transcript }),
  );
  const saved = await saveEndOfCallReport(report);
  assert.equal(saved.outcome, "saved");
  return saved.outcome === "saved" ? saved.callId : "";
}
