import type { assistantSettings } from "@/db/schema";

// One company's assistant settings as stored (step 45: one row per
// company), and what the app says about them at a glance.

export type AssistantSettingsRow = typeof assistantSettings.$inferSelect;

// What the sidebar shows under the restaurant's name.
export type AssistantGlance = {
  // "Open until 23:00", "Closed today", ...; null before hours are set.
  hours: { open: boolean; text: string } | null;
  // "Answers on its own", "Asks you first" or "Paused".
  mode: string;
};
