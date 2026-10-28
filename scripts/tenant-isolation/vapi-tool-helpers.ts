// Shared pieces for the Vapi tool checks (step 35): sending tool-calls
// messages through the real webhook handler, signed like Vapi, and what was
// logged meanwhile.

import { randomUUID } from "node:crypto";
import { KNOWLEDGE_TOOL_NAME } from "@/lib/validation/vapi-tool-calls";
import { getVapiSignatureSettings, signLikeVapi } from "@/lib/vapi-signature";
import { handleVapiWebhook } from "@/services/vapi-webhook";
import { buildSampleToolCallsMessage } from "../vapi-sample";
import { captureConsole, runId } from "./helpers";

// Phrases that must never reach the logs or the database: the live
// transcript in message.artifact, and the caller's number.
export const LIVE_TRANSCRIPT_PHRASE = `live-transcript-${runId}`;
export const TOOL_CALLER_NUMBER = `+1 555 02${Math.floor(Math.random() * 90 + 10)}`;

// Everything the handler printed during these checks.
export const toolCheckLogs: string[] = [];

// Analyses an end-of-call-report asked for. Recorded, NEVER run: running
// them would call the real, paid Claude API.
let scheduledAnalyses = 0;
const recordInsteadOfRunning = () => {
  scheduledAnalyses += 1;
};
export function countScheduledAnalyses(): number {
  return scheduledAnalyses;
}

export type ToolCallForCheck = { id?: string; name?: string; arguments: unknown };

// A tool-calls message for the call, on the line.
export function toolCallsMessage(phoneNumberId: string, callId: string, toolCalls: ToolCallForCheck[]) {
  return buildSampleToolCallsMessage({
    callId,
    phoneNumberId,
    callerNumber: TOOL_CALLER_NUMBER,
    transcript: `User: ${LIVE_TRANSCRIPT_PHRASE}`,
    toolCalls: toolCalls.map((toolCall) => ({
      id: toolCall.id ?? `toolu_${randomUUID()}`,
      name: toolCall.name ?? KNOWLEDGE_TOOL_NAME,
      arguments: toolCall.arguments,
    })),
  });
}

export type WebhookAnswer = {
  status: number;
  contentType: string | null;
  text: string;
  // The parsed answer's results, or null when the body wasn't one.
  results: Record<string, unknown>[] | null;
  logs: string[];
};

// Posts a body to the real handler with these headers.
export async function postToVapiWebhook(bytes: Buffer, headers: Record<string, string>): Promise<WebhookAnswer> {
  const request = new Request("http://localhost/api/webhooks/vapi", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: new Uint8Array(bytes),
  });
  const { result: response, logs } = await captureConsole(() => handleVapiWebhook(request, recordInsteadOfRunning));
  toolCheckLogs.push(...logs);
  const text = await response.text();
  return { status: response.status, contentType: response.headers.get("content-type"), text, results: readResults(text), logs };
}

// Posts a body signed exactly as Vapi would sign it now (or at `now`).
export function postSignedToVapiWebhook(body: unknown, now = new Date()): Promise<WebhookAnswer> {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  return postToVapiWebhook(bytes, signLikeVapi(bytes, getVapiSignatureSettings(), now));
}

// One search on the line during the call; returns the answer's one entry.
export async function searchDuringCall(phoneNumberId: string, callId: string, query: string): Promise<Record<string, unknown>> {
  const answer = await postSignedToVapiWebhook(toolCallsMessage(phoneNumberId, callId, [{ arguments: { query } }]));
  if (answer.status !== 200 || answer.results?.length !== 1) {
    throw new Error(`The search got HTTP ${answer.status} with ${answer.results?.length ?? "no"} results`);
  }
  return answer.results[0];
}

function readResults(text: string): Record<string, unknown>[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const results = (parsed as { results?: unknown }).results;
    return Array.isArray(results) ? (results as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}
