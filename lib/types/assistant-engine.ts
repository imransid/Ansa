import type { AiEngine } from "@/lib/assistant/engine";

// The assistant's AI engine (step 49) as Settings → Assistant shows it:
// which one, and whose key the API engine uses (never the key itself).
export type EngineState = {
  engine: AiEngine;
  // Whose key the API engine uses: the restaurant's (its last four), ansa's,
  // Claude Code on this computer standing in for ansa's (development, while
  // ansa has no key: the brain's free stand-in), or none.
  keySource: "restaurant" | "ansa" | "stand_in" | "none";
  keyHint: string | null;
  claudeCodeAllowed: boolean;
  ready: boolean;
};
