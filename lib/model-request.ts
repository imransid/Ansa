// What asking Claude takes and gives back, shared by the call brain
// (lib/call-brain), email triage (lib/email-triage), the Co-Founder's
// interview and suggestions from knowledge (lib/cofounder), its marketing
// plans (lib/marketing-plan) and its content drafts (lib/content-studio).
// Each has its own asker in
// adapters/claude.ts, with its own effort and time limits, so tuning one
// never changes another. The checks pass fakes instead, so they never call
// the real, paid API.

// One request: fixed instructions, the user message, and the JSON schema the
// answer must follow.
export type ModelRequest = {
  systemPrompt: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
};

// Everything that can come back from asking the model. Only "ok" carries
// model text, and that text is never logged.
export type ModelResult =
  | { kind: "ok"; outputText: string; usage: { inputTokens: number; outputTokens: number } }
  | { kind: "refused" }
  | { kind: "truncated" }
  | { kind: "unexpected-stop" }
  | { kind: "error"; errorName: string }
  | { kind: "unavailable" };

// The shape of any function that asks a model: the real ones in
// adapters/claude.ts, or a check's fake.
export type ModelAsker = (request: ModelRequest) => Promise<ModelResult>;
