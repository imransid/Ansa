// Which AI the restaurant's assistant uses (step 49, Settings → Assistant).
// Pure: the schema's CHECK, the form, the services and the checks share it.
//
// "api_key": the Claude API, with the restaurant's own key when an owner
//   saved one (stored encrypted), else ansa's (ANTHROPIC_API_KEY).
// "claude_code": the Claude Code login of the computer ansa runs on,
//   through its command line (adapters/claude-code.ts). DEVELOPMENT ONLY:
//   Anthropic doesn't allow a product to run on a claude.ai login, so
//   production never uses it, whatever is saved.

export const AI_ENGINES = ["api_key", "claude_code"] as const;
export type AiEngine = (typeof AI_ENGINES)[number];

export const AI_ENGINE_LABELS: Record<AiEngine, string> = {
  api_key: "Claude API key",
  claude_code: "Claude Code on this computer (development only)",
};

// The shape of an Anthropic API key: "sk-ant-" and then letters, digits,
// "-" and "_". Checked before anything is stored; never shown back whole.
export const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

// The last four characters, shown as "ends in ...abcd".
export function keyHint(key: string): string {
  return key.slice(-4);
}

export function claudeCodeAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}
