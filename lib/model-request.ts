// What asking Claude takes and gives back. The screens never ask Claude
// themselves: the brain does, each use with its own effort and time limits
// (brain/brain/ai.py), so tuning one never changes another. Only the answer
// readers in lib/menu-reading and lib/performance-review still take a
// ModelResult.

// One request: fixed instructions, the user message, and the JSON schema the
// answer must follow. image: a photo sent before the message, only ever a
// menu photo the owner uploaded (step 46), its type read from its own bytes.
export type ModelRequest = {
  systemPrompt: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  image?: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };
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

// The shape of any function that asks a model. The screens have none: the
// brain asks (ask() in brain/brain/ai.py).
export type ModelAsker = (request: ModelRequest) => Promise<ModelResult>;
