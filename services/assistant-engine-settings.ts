import "server-only";
import { z } from "zod";
import { saveAssistantEngine, type KeyChange } from "@/db/assistant-engine";
import { claudeCodeAllowed, keyHint } from "@/lib/assistant/engine";
import { encryptText } from "@/lib/encryption";
import { anthropicKeyContext } from "@/lib/encryption-contexts";
import type { FormResult } from "@/lib/form-result";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import type { SessionContext } from "@/lib/session";
import { aiEngineSchema } from "@/lib/validation/assistant";
import { getEngineState, type EngineState } from "./assistant-engine";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Settings → Assistant → AI engine (step 49): owners pick the Claude API
// (with the restaurant's own key, saved encrypted and never shown back but
// its last four characters, or ansa's) or, in development only, Claude
// Code on this computer. Members see which one is in use.

export async function getEngineStateForSession(session: SessionContext): Promise<EngineState & { canManage: boolean }> {
  return { ...(await getEngineState(session.companyId)), canManage: canManageRestaurant(session.role) };
}

export async function saveAiEngineForSession(session: SessionContext, input: unknown, nodeEnv: string | undefined = process.env.NODE_ENV): Promise<FormResult> {
  if (!canManageRestaurant(session.role)) {
    return { ok: false, errors: { message: "Only owners can change the AI engine." } };
  }
  if (await isOverRateLimit("settings-changes", session.userId, RATE_LIMITS.settingsChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const parsed = aiEngineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const { engine, apiKey, removeKey } = parsed.data;
  if (engine === "claude_code" && !claudeCodeAllowed(nodeEnv)) {
    return { ok: false, errors: { message: "Claude Code can only be used while developing ansa. Use a Claude API key." } };
  }
  const key: KeyChange = apiKey
    ? { encrypted: encryptText(apiKey, anthropicKeyContext(session.companyId)), hint: keyHint(apiKey) }
    : removeKey
      ? "remove"
      : "keep";
  const outcome = await saveAssistantEngine(session.companyId, session.userId, engine, key);
  return outcome === "saved" ? { ok: true } : { ok: false, errors: { message: "Only owners can change the AI engine." } };
}
