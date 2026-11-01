import type { AiEngine } from "@/lib/assistant/engine";

// The assistant's AI engine (step 49) as Settings → Assistant shows it:
// which one, and whose key the API engine uses (never the key itself).
export type EngineState = {
  engine: AiEngine;
  // Whose key the API engine uses: the restaurant's (its last four), ansa's, or none.
  keySource: "restaurant" | "ansa" | "none";
  keyHint: string | null;
  claudeCodeAllowed: boolean;
  ready: boolean;
};
