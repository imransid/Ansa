// Runs the call brain on one stored call and prints the verdict. Dry run:
// nothing is saved. Makes ONE real, paid Claude API call, unless a rule
// decides first (no transcript, abnormal end, ...).
//
// Run with: pnpm try:brain <callId>   (the id is in the call page's URL)
//
// Prints only the outcome, reason code, slice size and token usage. Never the
// transcript, the prompt or Claude's answer (Rule: never log those).

import { eq } from "drizzle-orm";
import { askClaudeForCallDecision } from "@/adapters/claude";
import { getActiveCategoryNames } from "@/db/categories";
import { db } from "@/db/client";
import { calls } from "@/db/schema";
import { buildTranscriptSlice } from "@/lib/call-brain/transcript-slice";
import { decryptText } from "@/lib/encryption";
import { callTranscriptContext } from "@/lib/encryption-contexts";
import { env } from "@/lib/env";
import { computeCallDecision } from "@/services/call-analysis";

async function main() {
  const callId = process.argv[2];
  if (!callId) {
    console.error("Usage: pnpm try:brain <callId>");
    process.exitCode = 1;
    return;
  }

  // Looked up directly by id (any company): fine for a local dev script only.
  const [call] = await db.select().from(calls).where(eq(calls.id, callId));
  if (!call) {
    console.error("No call with that id.");
    process.exitCode = 1;
    return;
  }

  const transcript = call.transcriptEncrypted
    ? decryptText(call.transcriptEncrypted, callTranscriptContext(call.companyId, call.vapiCallId))
    : null;
  if (transcript) {
    const slice = buildTranscriptSlice(transcript);
    const sentCharacters = [...slice.opening, ...slice.closing].reduce((sum, turn) => sum + turn.text.length, 0);
    console.log(`Slice: ${slice.opening.length + slice.closing.length} turns sent, ${slice.omittedTurnCount} left out, ${sentCharacters} characters.`);
  }

  console.log(`Model: ${env.ANTHROPIC_MODEL}${env.ANTHROPIC_API_KEY ? "" : " (no ANTHROPIC_API_KEY set)"}`);
  const categoryNames = await getActiveCategoryNames(call.companyId);
  console.log(`Categories offered: ${categoryNames.length}`);
  const { decision, askedModel, usage } = await computeCallDecision(transcript, call.endedReason, askClaudeForCallDecision, categoryNames);
  console.log(`Outcome: ${decision.outcome}`);
  console.log(`Decided by: ${decision.source}${askedModel ? "" : " (Claude was not asked)"}`);
  console.log(`Reason code: ${decision.reasonCode}`);
  console.log(`Category: ${decision.category ?? "(none)"}`);
  if (usage) {
    console.log(`Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out (thinking included in out).`);
  }
  console.log("Dry run: nothing was saved.");
}

main()
  .catch((error) => {
    console.error(`try:brain failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
