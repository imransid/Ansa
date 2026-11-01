import "server-only";
import { askClaudeCode } from "@/adapters/claude-code";
import { askClaudeForAssistantReply, askClaudeForAutopost, createClaudeClient } from "@/adapters/claude";
import { getAssistantEngine } from "@/db/assistant-engine";
import { claudeCodeAllowed, type AiEngine } from "@/lib/assistant/engine";
import { decryptForDisplay } from "@/lib/encryption";
import { anthropicKeyContext } from "@/lib/encryption-contexts";
import { env } from "@/lib/env";
import type { ModelAsker } from "@/lib/model-request";

// Which AI answers for a restaurant's assistant (step 49): the Claude API
// with the restaurant's own key, else ansa's; or, in development only,
// Claude Code on this computer (adapters/claude-code.ts: Anthropic doesn't
// allow a product to run on a claude.ai login). null: none is set up, and
// every message gets the holding reply.

// How long Claude Code may take for one answer: it starts a program first.
const CLAUDE_CODE_TIMEOUT_MS = 90_000;

export type EngineState = {
  engine: AiEngine;
  // Whose key the API engine uses: the restaurant's (its last four), ansa's, or none.
  keySource: "restaurant" | "ansa" | "none";
  keyHint: string | null;
  claudeCodeAllowed: boolean;
  ready: boolean;
};

// What Settings → Assistant shows about the engine (never the key itself).
export async function getEngineState(companyId: string, nodeEnv: string | undefined = process.env.NODE_ENV): Promise<EngineState> {
  const row = await getAssistantEngine(companyId);
  const keySource = row.anthropicKeyHint ? "restaurant" : env.ANTHROPIC_API_KEY ? "ansa" : "none";
  const allowed = claudeCodeAllowed(nodeEnv);
  const ready = row.aiEngine === "claude_code" ? allowed : keySource !== "none";
  return { engine: row.aiEngine, keySource, keyHint: row.anthropicKeyHint, claudeCodeAllowed: allowed, ready };
}

// The asker for this restaurant's assistant, or null when none is set up.
// `use`: a reply to a customer (step 49), or a "Post for me" post (step 54),
// each with its own settings (adapters/claude-settings.ts); the same
// engine and key pay for both.
export async function assistantAskerFor(companyId: string, nodeEnv: string | undefined = process.env.NODE_ENV, use: "reply" | "post" = "reply"): Promise<ModelAsker | null> {
  const row = await getAssistantEngine(companyId);
  if (row.aiEngine === "claude_code") {
    if (!claudeCodeAllowed(nodeEnv)) {
      console.warn("Assistant engine unavailable: Claude Code is for development only");
      return null;
    }
    return (request) =>
      askClaudeCode(request, { binaryPath: env.CLAUDE_CODE_PATH ?? "claude", model: env.ANTHROPIC_MODEL, effort: "low", timeoutMs: CLAUDE_CODE_TIMEOUT_MS });
  }
  const key = row.anthropicKeyEncrypted ? restaurantKey(companyId, row.anthropicKeyEncrypted) : (env.ANTHROPIC_API_KEY ?? null);
  if (!key) {
    return null;
  }
  const client = createClaudeClient(key);
  return use === "post" ? (request) => askClaudeForAutopost(request, client) : (request) => askClaudeForAssistantReply(request, client);
}

// The restaurant's own key, decrypted, or null when it can't be read: then
// ansa's own key is not used in its place, so nobody pays unaware.
function restaurantKey(companyId: string, encrypted: string): string | null {
  const key = decryptForDisplay(encrypted, anthropicKeyContext(companyId));
  return key.unreadable ? null : key.text;
}
