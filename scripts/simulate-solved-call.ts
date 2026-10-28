// Saves a made-up call that the AI marked "solved", to try "Escalate to a
// ticket" (step 31) without a Claude API key. The call is saved the way the
// Vapi webhook saves one, then decided by a stand-in for Claude that answers
// "solved" quoting the customer's closing sentence. The real guard still
// checks that sentence against the transcript, and the call page shows it.
// It writes to the database directly, so, like the checks, it only runs
// against a local database with every outside service off.
//
// Run with: pnpm simulate:solved-call <vapiPhoneNumberId>
// The number must be linked first (pnpm link:phone-line). The app doesn't
// need to be running.

import { randomInt, randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import type { ModelAsker } from "@/lib/model-request";
import { endOfCallReportSchema } from "@/lib/validation/vapi";
import { analyzeCall } from "@/services/call-analysis";
import { saveEndOfCallReport } from "@/services/calls";
import { findReasonNotToRunChecks } from "./tenant-isolation/local-only";
import { buildSampleEndOfCallReport } from "./vapi-sample";

const CONFIRMATION = "That fixed it, thank you so much.";

// A call that sounds solved, but the customer's problem may well come back:
// what a teammate escalates.
const TRANSCRIPT = [
  "AI: Thanks for calling. How can I help?",
  "User: My router keeps dropping the connection every evening.",
  "AI: Let's restart it and change the wifi channel. Please unplug it for ten seconds.",
  "User: Okay, done. It's back and the connection looks stable now.",
  "AI: Great. Is there anything else?",
  `User: No, that's all. ${CONFIRMATION}`,
  "AI: You're welcome, goodbye.",
].join("\n");

// Stands in for Claude: always "solved", with the customer's sentence as proof.
const answerSolved: ModelAsker = async () => ({
  kind: "ok",
  outputText: JSON.stringify({
    outcome: "solved",
    customer_issue: "The customer's router dropped the connection every evening.",
    resolution_evidence: CONFIRMATION,
    reason: "The agent changed the wifi channel and the customer confirmed it works.",
    ticket_subject: "Router drops the connection every evening",
    category: "",
  }),
  usage: { inputTokens: 0, outputTokens: 0 },
});

async function main() {
  const reasonNotToRun = findReasonNotToRunChecks(process.env);
  if (reasonNotToRun) {
    console.error(`Refusing to run (this writes a made-up call into the database): ${reasonNotToRun}`);
    process.exitCode = 1;
    return;
  }
  const phoneNumberId = process.argv[2];
  if (!phoneNumberId) {
    console.error("Usage: pnpm simulate:solved-call <vapiPhoneNumberId>");
    process.exitCode = 1;
    return;
  }

  // A new caller each run: one caller's calls count as one customer, whose
  // open ticket would decide who gets the next one (step 29).
  const callerNumber = `+1 555 ${randomInt(1000, 10_000)}`;
  const report = endOfCallReportSchema.parse(
    buildSampleEndOfCallReport({ callId: `sim-solved-${randomUUID()}`, phoneNumberId, callerNumber, transcript: TRANSCRIPT }),
  );
  const saved = await saveEndOfCallReport(report);
  if (saved.outcome !== "saved") {
    console.error("No call saved: link the number first (pnpm link:phone-line).");
    process.exitCode = 1;
    return;
  }
  await analyzeCall(saved.companyId, saved.callId, answerSolved);
  console.log(`Saved a call the AI marked solved: ${env.BETTER_AUTH_URL}/calls/${saved.callId}`);
}

main()
  .catch((error) => {
    console.error(`simulate:solved-call failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
