// Sends a made-up, signed Vapi tool-calls message to the running app, as the
// voice assistant does during a live call when it calls
// search_company_knowledge (step 35), and prints the answer it got. Signed
// exactly the way lib/env.ts says Vapi signs.
//
// Run with: pnpm simulate:vapi-tool-call <vapiPhoneNumberId> "<question>" [--call <vapiCallId>] [--end-call]
//   --call      looks it up during that call (an id an earlier run printed),
//               so one call can make several lookups. Default: a new call.
//   --end-call  then ends the call: sends its end-of-call-report, so the
//               call and what it looked up show on the Calls page.
// Needs `pnpm dev` running and the number linked with pnpm link:phone-line.

import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { KNOWLEDGE_TOOL_NAME } from "@/lib/validation/vapi-tool-calls";
import { getVapiSignatureSettings, signLikeVapi } from "@/lib/vapi-signature";
import { buildSampleEndOfCallReport, buildSampleToolCallsMessage, SAMPLE_TRANSCRIPT } from "./vapi-sample";

const WEBHOOK_URL = `${env.BETTER_AUTH_URL}/api/webhooks/vapi`;
const CALLER_NUMBER = "+1 555 0142";

type Options = { phoneNumberId: string; question: string; callId: string; endCall: boolean };

function readOptions(args: string[]): Options | null {
  const positional: string[] = [];
  let callId = `sim-${randomUUID()}`;
  let endCall = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--end-call") {
      endCall = true;
    } else if (args[index] === "--call" && args[index + 1]) {
      callId = args[index + 1];
      index += 1;
    } else {
      positional.push(args[index]);
    }
  }
  const [phoneNumberId, question] = positional;
  if (!phoneNumberId || question === undefined || positional.length > 2) {
    return null;
  }
  return { phoneNumberId, question, callId, endCall };
}

// Posts a body signed like Vapi and returns the status and the body's text.
async function postSigned(body: unknown): Promise<{ status: number; text: string }> {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...signLikeVapi(bytes, getVapiSignatureSettings(), new Date()) },
    body: new Uint8Array(bytes),
  });
  return { status: response.status, text: await response.text() };
}

// Prints each entry of the tool-calls answer: the result, or the error.
function printAnswer(text: string) {
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    console.log("The answer was not JSON.");
    return;
  }
  const results = (answer as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) {
    console.log("No results in the answer.");
    return;
  }
  for (const entry of results as Record<string, unknown>[]) {
    console.log("error" in entry ? `error:  ${String(entry.error)}` : `result: ${String(entry.result)}`);
  }
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (!options) {
    console.error('Usage: pnpm simulate:vapi-tool-call <vapiPhoneNumberId> "<question>" [--call <vapiCallId>] [--end-call]');
    process.exitCode = 1;
    return;
  }
  const message = buildSampleToolCallsMessage({
    callId: options.callId,
    phoneNumberId: options.phoneNumberId,
    callerNumber: CALLER_NUMBER,
    toolCalls: [{ id: `toolu_${randomUUID()}`, name: KNOWLEDGE_TOOL_NAME, arguments: { query: options.question } }],
    transcript: `AI: Thanks for calling. How can I help?\nUser: ${options.question}`,
  });
  console.log(`Call: ${options.callId}`);
  const answer = await postSigned(message);
  console.log(`Tool call answered with HTTP ${answer.status}`);
  printAnswer(answer.text);
  if (answer.status !== 200) {
    process.exitCode = 1;
  }

  if (options.endCall) {
    const report = buildSampleEndOfCallReport({
      callId: options.callId,
      phoneNumberId: options.phoneNumberId,
      callerNumber: CALLER_NUMBER,
      transcript: SAMPLE_TRANSCRIPT,
    });
    const ended = await postSigned(report);
    console.log(`End-of-call-report answered with HTTP ${ended.status}. Open Calls in the app to see what the call looked up.`);
    if (ended.status !== 200) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error("Simulation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
