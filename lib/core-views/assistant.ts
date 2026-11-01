import "server-only";
import { callCore } from "@/lib/core-api";
import { coreFormErrors } from "@/lib/core-views/restaurant-setup";
import type { FormErrors } from "@/lib/form-result";
import type { EngineState } from "@/lib/types/assistant-engine";
import type { AssistantTestResult } from "@/lib/types/assistant-test";

// Settings → Assistant (how ansa answers, the AI engine, "Try your
// assistant") through the new backend (core's /api/v1/settings/assistant
// and /api/v1/assistant/try), in the shapes the page and its forms already
// read.

type CoreAssistantSettings = {
  settings: { engine: EngineState["engine"]; keyHint: string };
  canManage: boolean;
  engineState: { keySource: EngineState["keySource"]; claudeCodeAllowed: boolean; ready: boolean };
};

// Which AI writes replies, whose key it uses (never the key: its last four
// at most), and whether it is ready.
export async function getEngineStateFromCore(): Promise<EngineState & { canManage: boolean }> {
  const answer = await callCore<CoreAssistantSettings>("GET", "/api/v1/settings/assistant");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { settings, canManage, engineState } = answer.data;
  return {
    engine: settings.engine,
    keySource: engineState.keySource,
    keyHint: settings.keyHint === "" ? null : settings.keyHint,
    claudeCodeAllowed: engineState.claudeCodeAllowed,
    ready: engineState.ready,
    canManage,
  };
}

// Settings → Assistant's "How ansa answers".
export async function saveAssistantSettingsThroughCore(formData: FormData): Promise<{ ok: true } | { ok: false; errors: FormErrors }> {
  const answer = await callCore("POST", "/api/v1/settings/assistant", {
    status: textOf(formData, "status"),
    replyMode: textOf(formData, "replyMode"),
    instructions: textOf(formData, "instructions"),
    holdingReply: textOf(formData, "holdingReply"),
    // A ticked checkbox sends "on"; an unticked one sends nothing.
    alertByEmail: formData.get("alertByEmail") === "on",
  });
  return answer.ok ? { ok: true } : { ok: false, errors: coreFormErrors(answer) };
}

// Saves the AI engine. The key goes to core once and is never sent back.
export async function saveAiEngineThroughCore(formData: FormData): Promise<{ ok: true } | { ok: false; errors: FormErrors }> {
  const answer = await callCore("POST", "/api/v1/settings/assistant/engine", {
    engine: textOf(formData, "engine"),
    apiKey: textOf(formData, "apiKey"),
    removeKey: formData.get("removeKey") === "on",
  });
  return answer.ok ? { ok: true } : { ok: false, errors: coreFormErrors(answer) };
}

// What the assistant would answer one typed message. Nothing is saved or sent.
export async function testAssistantThroughCore(formData: FormData): Promise<AssistantTestResult> {
  const answer = await callCore<{ outcome: "reply" | "handover" | "no_reply"; text: string; why: string }>("POST", "/api/v1/assistant/try", {
    text: textOf(formData, "text"),
  });
  if (!answer.ok) {
    return { ok: false, errors: coreFormErrors(answer) };
  }
  const { outcome, text, why } = answer.data;
  if (outcome === "reply") {
    return { ok: true, outcome: "reply", text };
  }
  if (outcome === "handover") {
    // Core's text is the holding reply the customer would get then.
    return { ok: true, outcome: "handover", holdingReply: text, why };
  }
  return { ok: true, outcome: "no_reply" };
}

// A form value as the forms send it: text, or nothing.
function textOf(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
