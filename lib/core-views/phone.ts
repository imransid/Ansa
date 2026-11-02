import "server-only";
import { callCore } from "@/lib/core-api";

// The practice phone (step 55, development only): an owner calls their own
// ansa from this computer. Core answers each turn with the same assistant as
// chats (core/internal/phone); the page speaks ansa's words. A recording is
// heard by the brain's Whisper on this computer: nothing leaves it.

export type PracticePhone = { available: boolean; isOwner: boolean };
export type PracticeCallStarted = { ok: true; callId: string; conversationId: string; words: string[] } | { ok: false; error: string };
export type PracticeCallTurn = { ok: true; heard: string; words: string[] } | { ok: false; error: string; over: boolean };

// Whether this person may use the practice phone here (an owner, development).
export async function getPracticePhoneFromCore(): Promise<PracticePhone> {
  const answer = await callCore<PracticePhone>("GET", "/api/v1/phone/practice");
  return answer.ok ? answer.data : { available: false, isOwner: false };
}

// Picks up a practice call from this caller: ansa's greeting.
export async function startPracticeCallThroughCore(callerName: string, callerNumber: string): Promise<PracticeCallStarted> {
  const answer = await callCore<{ callId: string; conversationId: string; words: string[] }>("POST", "/api/v1/phone/practice/start", { callerName, callerNumber });
  if (!answer.ok) {
    return { ok: false, error: answer.fields.callerNumber ?? answer.message };
  }
  return { ok: true, callId: answer.data.callId, conversationId: answer.data.conversationId, words: answer.data.words };
}

// One thing the caller said (typed, or a recording as base64 WAV): what ansa heard and answers.
export async function practiceCallTurnThroughCore(callId: string, said: { text: string } | { audio: string }): Promise<PracticeCallTurn> {
  const answer = await callCore<{ heard: string; words: string[] }>("POST", "/api/v1/phone/practice/turn", { callId, ...said });
  if (!answer.ok) {
    return { ok: false, error: answer.message, over: answer.status === 409 };
  }
  return { ok: true, heard: answer.data.heard, words: answer.data.words };
}

// Hangs up (a request is opened for any message ansa took).
export async function endPracticeCallThroughCore(callId: string): Promise<void> {
  await callCore("POST", "/api/v1/phone/practice/end", { callId });
}
